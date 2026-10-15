// api/_lib/admin.ts
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getDatabase } from "firebase-admin/database";
function app() {
  const existing = getApps()[0];
  if (existing) return existing;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!projectId || !databaseURL) throw new Error("Firebase Admin settings are missing");
  const credential = clientEmail && privateKey ? cert({ projectId, clientEmail, privateKey }) : process.env.GOOGLE_APPLICATION_CREDENTIALS ? applicationDefault() : null;
  if (!credential) throw new Error("Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or GOOGLE_APPLICATION_CREDENTIALS");
  return initializeApp({ credential, projectId, databaseURL });
}
async function verifyToken(token) {
  return (await getAuth(app()).verifyIdToken(token)).uid;
}
function getAdmin(uid) {
  if (!uid) throw new Error("Firebase user ID required");
  const database = getDatabase(app());
  const table = (name) => database.ref(`apps/paintos/users/${uid}/${name}`);
  const textRef = (name, path) => database.ref(`apps/paintos/users/${uid}/artifact_text/${name}/${encodeURIComponent(path).replaceAll(".", "%2E")}`);
  const isText = (path) => path.endsWith(".json");
  const cloud = process.env.VITE_CLOUDINARY_CLOUD_NAME;
  const preset = process.env.VITE_CLOUDINARY_UPLOAD_PRESET;
  const asError = (error) => ({ message: error instanceof Error ? error.message : String(error) });
  class Query {
    constructor(name, action = "read") {
      this.name = name;
      this.action = action;
    }
    filters = [];
    ordering = [];
    max = null;
    one = false;
    optional = false;
    records = [];
    changes = {};
    select(_fields = "*") {
      return this;
    }
    eq(key, value) {
      this.filters.push({ key, value });
      return this;
    }
    order(key, options) {
      this.ordering.push({ key, ascending: options?.ascending !== false });
      return this;
    }
    limit(max) {
      this.max = max;
      return this;
    }
    maybeSingle() {
      this.one = true;
      this.optional = true;
      return this;
    }
    single() {
      this.one = true;
      return this;
    }
    insert(records) {
      this.action = "insert";
      this.records = Array.isArray(records) ? records : [records];
      return this;
    }
    update(changes) {
      this.action = "update";
      this.changes = changes;
      return this;
    }
    delete() {
      this.action = "delete";
      return this;
    }
    async run() {
      try {
        const value = (await table(this.name).get()).val();
        let rows = Object.entries(value ?? {}).map(([id, row]) => ({ ...row, id }));
        rows = rows.filter((row) => this.filters.every((f) => row[f.key] === f.value));
        if (this.action === "read") {
          for (const order of [...this.ordering].reverse()) rows.sort((a, b) => String(a[order.key] ?? "").localeCompare(String(b[order.key] ?? "")) * (order.ascending ? 1 : -1));
          if (this.max !== null) rows = rows.slice(0, this.max);
        } else if (this.action === "insert") {
          rows = await Promise.all(this.records.map(async (record) => {
            const row = { ...record, id: String(record.id || crypto.randomUUID()) };
            await table(this.name).child(row.id).set(row);
            return row;
          }));
        } else if (this.action === "update") {
          rows = await Promise.all(rows.map(async (row) => {
            const updated = { ...row, ...this.changes };
            await table(this.name).child(String(row.id)).update(this.changes);
            return updated;
          }));
        } else {
          await Promise.all(rows.map((row) => table(this.name).child(String(row.id)).remove()));
        }
        if (this.one) return rows.length ? { data: rows[0], error: null } : this.optional ? { data: null, error: null } : { data: null, error: { message: "Row not found" } };
        return { data: rows, error: null };
      } catch (error) {
        return { data: null, error: asError(error) };
      }
    }
    then(onfulfilled, onrejected) {
      return this.run().then(onfulfilled, onrejected);
    }
  }
  return {
    from: (name) => new Query(name),
    storage: { from: (name) => ({
      async download(path) {
        try {
          if (isText(path)) {
            const value = (await textRef(name, path).get()).val();
            if (typeof value !== "string") throw new Error("Stored text not found");
            return { data: new Blob([value], { type: "application/json" }), error: null };
          }
          const url = new URL(path);
          if (!cloud || url.protocol !== "https:" || url.hostname !== "res.cloudinary.com" || !url.pathname.startsWith(`/${cloud}/image/upload/`)) throw new Error("Untrusted media URL");
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Media download HTTP ${response.status}`);
          return { data: new Blob([await response.arrayBuffer()]), error: null };
        } catch (error) {
          return { data: null, error: asError(error) };
        }
      },
      async upload(path, value, options) {
        try {
          if (isText(path)) {
            await textRef(name, path).set(typeof value === "string" ? value : value.toString("utf8"));
            return { data: { path }, error: null };
          }
          if (!cloud || !preset) throw new Error("Cloudinary settings are missing");
          const folder = name === "source-images" ? "paintos/sources" : "paintos/generated";
          const filename = path.startsWith("https://") ? `${crypto.randomUUID()}.svg` : path.split("/").pop() || "image.svg";
          const file = new Blob([typeof value === "string" ? value : Uint8Array.from(value)], { type: options?.contentType || "image/svg+xml" });
          const body = new FormData();
          body.set("file", file, filename);
          body.set("upload_preset", preset);
          body.set("folder", folder);
          body.set("asset_folder", folder);
          body.set("public_id_prefix", folder);
          const response = await fetch(`https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`, { method: "POST", body });
          const json = await response.json();
          if (!response.ok || !json.secure_url) throw new Error(json.error?.message || "Cloudinary upload failed");
          return { data: { path: json.secure_url }, error: null };
        } catch (error) {
          return { data: null, error: asError(error) };
        }
      }
    }) }
  };
}

// engine/generate.ts
import * as nodeCanvas from "canvas";

// engine/src/common.ts
async function delay(ms) {
  if (typeof window !== "undefined") {
    return new Promise((exec) => window.setTimeout(exec, ms));
  } else {
    return new Promise((exec) => exec());
  }
}

// engine/src/lib/clustering.ts
var Vector = class _Vector {
  constructor(values, weight = 1) {
    this.values = values;
    this.weight = weight;
  }
  distanceTo(p) {
    let sumSquares = 0;
    for (let i = 0; i < this.values.length; i++) {
      sumSquares += (p.values[i] - this.values[i]) * (p.values[i] - this.values[i]);
    }
    return Math.sqrt(sumSquares);
  }
  /**
   *  Calculates the weighted average of the given points
   */
  static average(pts) {
    if (pts.length === 0) {
      throw Error("Can't average 0 elements");
    }
    const dims = pts[0].values.length;
    const values = [];
    for (let i = 0; i < dims; i++) {
      values.push(0);
    }
    let weightSum = 0;
    for (const p of pts) {
      weightSum += p.weight;
      for (let i = 0; i < dims; i++) {
        values[i] += p.weight * p.values[i];
      }
    }
    for (let i = 0; i < values.length; i++) {
      values[i] /= weightSum;
    }
    return new _Vector(values);
  }
};
var KMeans = class {
  constructor(points, k, random, centroids = null) {
    this.points = points;
    this.k = k;
    this.random = random;
    this.currentIteration = 0;
    this.pointsPerCategory = [];
    this.centroids = [];
    this.currentDeltaDistanceDifference = 0;
    if (centroids != null) {
      this.centroids = centroids;
      for (let i = 0; i < this.k; i++) {
        this.pointsPerCategory.push([]);
      }
    } else {
      this.initCentroids();
    }
  }
  initCentroids() {
    for (let i = 0; i < this.k; i++) {
      this.centroids.push(this.points[Math.floor(this.points.length * this.random.next())]);
      this.pointsPerCategory.push([]);
    }
  }
  step() {
    for (let i = 0; i < this.k; i++) {
      this.pointsPerCategory[i] = [];
    }
    for (const p of this.points) {
      let minDist = Number.MAX_VALUE;
      let centroidIndex = -1;
      for (let k = 0; k < this.k; k++) {
        const dist = this.centroids[k].distanceTo(p);
        if (dist < minDist) {
          centroidIndex = k;
          minDist = dist;
        }
      }
      this.pointsPerCategory[centroidIndex].push(p);
    }
    let totalDistanceDiff = 0;
    for (let k = 0; k < this.pointsPerCategory.length; k++) {
      const cat = this.pointsPerCategory[k];
      if (cat.length > 0) {
        const avg = Vector.average(cat);
        const dist = this.centroids[k].distanceTo(avg);
        totalDistanceDiff += dist;
        this.centroids[k] = avg;
      }
    }
    this.currentDeltaDistanceDifference = totalDistanceDiff;
    this.currentIteration++;
  }
};

// engine/src/lib/colorconversion.ts
function rgbToHsl(r, g, b) {
  r /= 255, g /= 255, b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
      default:
        h = 0;
    }
    h /= 6;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p2, q2, t) => {
      if (t < 0) {
        t += 1;
      }
      if (t > 1) {
        t -= 1;
      }
      if (t < 1 / 6) {
        return p2 + (q2 - p2) * 6 * t;
      }
      if (t < 1 / 2) {
        return q2;
      }
      if (t < 2 / 3) {
        return p2 + (q2 - p2) * (2 / 3 - t) * 6;
      }
      return p2;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}
function lab2rgb(lab) {
  let y = (lab[0] + 16) / 116, x = lab[1] / 500 + y, z = y - lab[2] / 200, r, g, b;
  x = 0.95047 * (x * x * x > 8856e-6 ? x * x * x : (x - 16 / 116) / 7.787);
  y = 1 * (y * y * y > 8856e-6 ? y * y * y : (y - 16 / 116) / 7.787);
  z = 1.08883 * (z * z * z > 8856e-6 ? z * z * z : (z - 16 / 116) / 7.787);
  r = x * 3.2406 + y * -1.5372 + z * -0.4986;
  g = x * -0.9689 + y * 1.8758 + z * 0.0415;
  b = x * 0.0557 + y * -0.204 + z * 1.057;
  r = r > 31308e-7 ? 1.055 * Math.pow(r, 1 / 2.4) - 0.055 : 12.92 * r;
  g = g > 31308e-7 ? 1.055 * Math.pow(g, 1 / 2.4) - 0.055 : 12.92 * g;
  b = b > 31308e-7 ? 1.055 * Math.pow(b, 1 / 2.4) - 0.055 : 12.92 * b;
  return [
    Math.max(0, Math.min(1, r)) * 255,
    Math.max(0, Math.min(1, g)) * 255,
    Math.max(0, Math.min(1, b)) * 255
  ];
}
function rgb2lab(rgb) {
  let r = rgb[0] / 255, g = rgb[1] / 255, b = rgb[2] / 255, x, y, z;
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
  x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1;
  z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  x = x > 8856e-6 ? Math.pow(x, 1 / 3) : 7.787 * x + 16 / 116;
  y = y > 8856e-6 ? Math.pow(y, 1 / 3) : 7.787 * y + 16 / 116;
  z = z > 8856e-6 ? Math.pow(z, 1 / 3) : 7.787 * z + 16 / 116;
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

// engine/src/settings.ts
var Settings = class {
  constructor() {
    this.kMeansNrOfClusters = 16;
    this.kMeansMinDeltaDifference = 1;
    this.kMeansClusteringColorSpace = 0 /* RGB */;
    this.kMeansColorRestrictions = [];
    this.colorAliases = {};
    this.narrowPixelStripCleanupRuns = 3;
    // 3 seems like a good compromise between removing enough narrow pixel strips to convergence. This fixes e.g. https://i.imgur.com/dz4ANz1.png
    this.removeFacetsSmallerThanNrOfPoints = 20;
    this.removeFacetsFromLargeToSmall = true;
    this.maximumNumberOfFacets = Number.MAX_VALUE;
    this.nrOfTimesToHalveBorderSegments = 2;
    this.resizeImageIfTooLarge = true;
    this.resizeImageWidth = 1024;
    this.resizeImageHeight = 1024;
    this.randomSeed = (/* @__PURE__ */ new Date()).getTime();
  }
};

// engine/src/structs/typedarrays.ts
var Uint32Array2D = class {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.arr = new Uint32Array(width * height);
  }
  get(x, y) {
    return this.arr[y * this.width + x];
  }
  set(x, y, value) {
    this.arr[y * this.width + x] = value;
  }
};
var Uint8Array2D = class {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.arr = new Uint8Array(width * height);
  }
  get(x, y) {
    return this.arr[y * this.width + x];
  }
  set(x, y, value) {
    this.arr[y * this.width + x] = value;
  }
  matchAllAround(x, y, value) {
    const idx = y * this.width + x;
    return x - 1 >= 0 && this.arr[idx - 1] === value && (y - 1 >= 0 && this.arr[idx - this.width] === value) && (x + 1 < this.width && this.arr[idx + 1] === value) && (y + 1 < this.height && this.arr[idx + this.width] === value);
  }
};
var BooleanArray2D = class {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.arr = new Uint8Array(width * height);
  }
  get(x, y) {
    return this.arr[y * this.width + x] !== 0;
  }
  set(x, y, value) {
    this.arr[y * this.width + x] = value ? 1 : 0;
  }
};

// engine/src/random.ts
var Random = class {
  constructor(seed) {
    if (typeof seed === "undefined") {
      this.seed = (/* @__PURE__ */ new Date()).getTime();
    } else {
      this.seed = seed;
    }
  }
  next() {
    const x = Math.sin(this.seed++) * 1e4;
    return x - Math.floor(x);
  }
};

// engine/src/colorreductionmanagement.ts
var ColorMapResult = class {
};
var ColorReducer = class _ColorReducer {
  /**
   *  Creates a map of the various colors used
   */
  static createColorMap(kmeansImgData) {
    const imgColorIndices = new Uint8Array2D(kmeansImgData.width, kmeansImgData.height);
    let colorIndex = 0;
    const colors = {};
    const colorsByIndex = [];
    let idx = 0;
    for (let j = 0; j < kmeansImgData.height; j++) {
      for (let i = 0; i < kmeansImgData.width; i++) {
        const r = kmeansImgData.data[idx++];
        const g = kmeansImgData.data[idx++];
        const b = kmeansImgData.data[idx++];
        const a = kmeansImgData.data[idx++];
        let currentColorIndex;
        const color = r + "," + g + "," + b;
        if (typeof colors[color] === "undefined") {
          currentColorIndex = colorIndex;
          colors[color] = colorIndex;
          colorsByIndex.push([r, g, b]);
          colorIndex++;
        } else {
          currentColorIndex = colors[color];
        }
        imgColorIndices.set(i, j, currentColorIndex);
      }
    }
    const result = new ColorMapResult();
    result.imgColorIndices = imgColorIndices;
    result.colorsByIndex = colorsByIndex;
    result.width = kmeansImgData.width;
    result.height = kmeansImgData.height;
    return result;
  }
  /**
   *  Applies K-means clustering on the imgData to reduce the colors to
   *  k clusters and then output the result to the given outputImgData
   */
  static async applyKMeansClustering(imgData, outputImgData, ctx, settings, onUpdate = null) {
    const vectors = [];
    let idx = 0;
    let vIdx = 0;
    const bitsToChopOff = 2;
    const pointsByColor = {};
    for (let j = 0; j < imgData.height; j++) {
      for (let i = 0; i < imgData.width; i++) {
        let r = imgData.data[idx++];
        let g = imgData.data[idx++];
        let b = imgData.data[idx++];
        const a = imgData.data[idx++];
        r = r >> bitsToChopOff << bitsToChopOff;
        g = g >> bitsToChopOff << bitsToChopOff;
        b = b >> bitsToChopOff << bitsToChopOff;
        const color = `${r},${g},${b}`;
        if (!(color in pointsByColor)) {
          pointsByColor[color] = [j * imgData.width + i];
        } else {
          pointsByColor[color].push(j * imgData.width + i);
        }
      }
    }
    for (const color of Object.keys(pointsByColor)) {
      const rgb = color.split(",").map((v) => parseInt(v));
      let data;
      if (settings.kMeansClusteringColorSpace === 0 /* RGB */) {
        data = rgb;
      } else if (settings.kMeansClusteringColorSpace === 1 /* HSL */) {
        data = rgbToHsl(rgb[0], rgb[1], rgb[2]);
      } else if (settings.kMeansClusteringColorSpace === 2 /* LAB */) {
        data = rgb2lab(rgb);
      } else {
        data = rgb;
      }
      const weight = pointsByColor[color].length / (imgData.width * imgData.height);
      const vec = new Vector(data, weight);
      vec.tag = rgb;
      vectors[vIdx++] = vec;
    }
    const random = new Random(settings.randomSeed === 0 ? (/* @__PURE__ */ new Date()).getTime() : settings.randomSeed);
    const kmeans = new KMeans(vectors, settings.kMeansNrOfClusters, random);
    let curTime = (/* @__PURE__ */ new Date()).getTime();
    kmeans.step();
    while (kmeans.currentDeltaDistanceDifference > settings.kMeansMinDeltaDifference) {
      kmeans.step();
      if ((/* @__PURE__ */ new Date()).getTime() - curTime > 500) {
        curTime = (/* @__PURE__ */ new Date()).getTime();
        await delay(0);
        if (onUpdate != null) {
          _ColorReducer.updateKmeansOutputImageData(kmeans, settings, pointsByColor, imgData, outputImgData, false);
          onUpdate(kmeans);
        }
      }
    }
    _ColorReducer.updateKmeansOutputImageData(kmeans, settings, pointsByColor, imgData, outputImgData, true);
    if (onUpdate != null) {
      onUpdate(kmeans);
    }
  }
  /**
   *  Updates the image data from the current kmeans centroids and their respective associated colors (vectors)
   */
  static updateKmeansOutputImageData(kmeans, settings, pointsByColor, imgData, outputImgData, restrictToSpecifiedColors) {
    for (let c = 0; c < kmeans.centroids.length; c++) {
      const centroid = kmeans.centroids[c];
      for (const v of kmeans.pointsPerCategory[c]) {
        let rgb;
        if (settings.kMeansClusteringColorSpace === 0 /* RGB */) {
          rgb = centroid.values;
        } else if (settings.kMeansClusteringColorSpace === 1 /* HSL */) {
          const hsl = centroid.values;
          rgb = hslToRgb(hsl[0], hsl[1], hsl[2]);
        } else if (settings.kMeansClusteringColorSpace === 2 /* LAB */) {
          const lab = centroid.values;
          rgb = lab2rgb(lab);
        } else {
          rgb = centroid.values;
        }
        rgb = rgb.map((v2) => Math.floor(v2));
        if (restrictToSpecifiedColors) {
          if (settings.kMeansColorRestrictions.length > 0) {
            let minDistance = Number.MAX_VALUE;
            let closestRestrictedColor = null;
            for (const color of settings.kMeansColorRestrictions) {
              const centroidLab = rgb2lab(rgb);
              let restrictionLab;
              if (typeof color === "string") {
                restrictionLab = rgb2lab(settings.colorAliases[color]);
              } else {
                restrictionLab = rgb2lab(color);
              }
              const distance = Math.sqrt((centroidLab[0] - restrictionLab[0]) * (centroidLab[0] - restrictionLab[0]) + (centroidLab[1] - restrictionLab[1]) * (centroidLab[1] - restrictionLab[1]) + (centroidLab[2] - restrictionLab[2]) * (centroidLab[2] - restrictionLab[2]));
              if (distance < minDistance) {
                minDistance = distance;
                closestRestrictedColor = color;
              }
            }
            if (closestRestrictedColor !== null) {
              if (typeof closestRestrictedColor === "string") {
                rgb = settings.colorAliases[closestRestrictedColor];
              } else {
                rgb = closestRestrictedColor;
              }
            }
          }
        }
        let pointRGB = v.tag;
        const pointColor = `${Math.floor(pointRGB[0])},${Math.floor(pointRGB[1])},${Math.floor(pointRGB[2])}`;
        for (const pt of pointsByColor[pointColor]) {
          const ptx = pt % imgData.width;
          const pty = Math.floor(pt / imgData.width);
          let dataOffset = (pty * imgData.width + ptx) * 4;
          outputImgData.data[dataOffset++] = rgb[0];
          outputImgData.data[dataOffset++] = rgb[1];
          outputImgData.data[dataOffset++] = rgb[2];
        }
      }
    }
  }
  /**
   *  Builds a distance matrix for each color to each other
   */
  static buildColorDistanceMatrix(colorsByIndex) {
    const colorDistances = new Array(colorsByIndex.length);
    for (let j = 0; j < colorsByIndex.length; j++) {
      colorDistances[j] = new Array(colorDistances.length);
    }
    for (let j = 0; j < colorsByIndex.length; j++) {
      for (let i = j; i < colorsByIndex.length; i++) {
        const c1 = colorsByIndex[j];
        const c2 = colorsByIndex[i];
        const distance = Math.sqrt((c1[0] - c2[0]) * (c1[0] - c2[0]) + (c1[1] - c2[1]) * (c1[1] - c2[1]) + (c1[2] - c2[2]) * (c1[2] - c2[2]));
        colorDistances[i][j] = distance;
        colorDistances[j][i] = distance;
      }
    }
    return colorDistances;
  }
  static async processNarrowPixelStripCleanup(colormapResult) {
    const colorDistances = _ColorReducer.buildColorDistanceMatrix(colormapResult.colorsByIndex);
    let count = 0;
    const imgColorIndices = colormapResult.imgColorIndices;
    for (let j = 1; j < colormapResult.height - 1; j++) {
      for (let i = 1; i < colormapResult.width - 1; i++) {
        const top = imgColorIndices.get(i, j - 1);
        const bottom = imgColorIndices.get(i, j + 1);
        const left = imgColorIndices.get(i - 1, j);
        const right = imgColorIndices.get(i + 1, j);
        const cur = imgColorIndices.get(i, j);
        if (cur !== top && cur !== bottom && cur !== left && cur !== right) {
        } else if (cur !== top && cur !== bottom) {
          const topColorDistance = colorDistances[cur][top];
          const bottomColorDistance = colorDistances[cur][bottom];
          imgColorIndices.set(i, j, topColorDistance < bottomColorDistance ? top : bottom);
          count++;
        } else if (cur !== left && cur !== right) {
          const leftColorDistance = colorDistances[cur][left];
          const rightColorDistance = colorDistances[cur][right];
          imgColorIndices.set(i, j, leftColorDistance < rightColorDistance ? left : right);
          count++;
        }
      }
    }
    console.log(count + " pixels replaced to remove narrow pixel strips");
  }
};

// engine/src/structs/point.ts
var Point = class {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  distanceTo(pt) {
    return Math.abs(pt.x - this.x) + Math.abs(pt.y - this.y);
  }
  distanceToCoord(x, y) {
    return Math.abs(x - this.x) + Math.abs(y - this.y);
  }
};

// engine/src/facetmanagement.ts
var PathPoint = class extends Point {
  constructor(pt, orientation) {
    super(pt.x, pt.y);
    this.orientation = orientation;
  }
  getWallX() {
    let x = this.x;
    if (this.orientation === 0 /* Left */) {
      x -= 0.5;
    } else if (this.orientation === 2 /* Right */) {
      x += 0.5;
    }
    return x;
  }
  getWallY() {
    let y = this.y;
    if (this.orientation === 1 /* Top */) {
      y -= 0.5;
    } else if (this.orientation === 3 /* Bottom */) {
      y += 0.5;
    }
    return y;
  }
  getNeighbour(facetResult) {
    switch (this.orientation) {
      case 0 /* Left */:
        if (this.x - 1 >= 0) {
          return facetResult.facetMap.get(this.x - 1, this.y);
        }
        break;
      case 2 /* Right */:
        if (this.x + 1 < facetResult.width) {
          return facetResult.facetMap.get(this.x + 1, this.y);
        }
        break;
      case 1 /* Top */:
        if (this.y - 1 >= 0) {
          return facetResult.facetMap.get(this.x, this.y - 1);
        }
        break;
      case 3 /* Bottom */:
        if (this.y + 1 < facetResult.height) {
          return facetResult.facetMap.get(this.x, this.y + 1);
        }
        break;
    }
    return -1;
  }
  toString() {
    return this.x + "," + this.y + " " + this.orientation;
  }
};
var Facet = class {
  constructor() {
    this.pointCount = 0;
    /**
     * Flag indicating if the neighbourfacets array is dirty. If it is, the neighbourfacets *have* to be rebuild
     * Before it can be used. This is useful to defer the rebuilding of the array until it's actually needed
     * and can remove a lot of duplicate building of the array because multiple facets were hitting the same neighbour
     * (over 50% on test images)
     */
    this.neighbourFacetsIsDirty = false;
  }
  getFullPathFromBorderSegments(useWalls) {
    const newpath = [];
    const addPoint = (pt) => {
      if (useWalls) {
        newpath.push(new Point(pt.getWallX(), pt.getWallY()));
      } else {
        newpath.push(new Point(pt.x, pt.y));
      }
    };
    let lastSegment = null;
    for (const seg of this.borderSegments) {
      if (lastSegment != null) {
        if (lastSegment.reverseOrder) {
          addPoint(lastSegment.originalSegment.points[0]);
        } else {
          addPoint(lastSegment.originalSegment.points[lastSegment.originalSegment.points.length - 1]);
        }
      }
      for (let i = 0; i < seg.originalSegment.points.length; i++) {
        const idx = seg.reverseOrder ? seg.originalSegment.points.length - 1 - i : i;
        addPoint(seg.originalSegment.points[idx]);
      }
      lastSegment = seg;
    }
    return newpath;
  }
};
var FacetResult = class {
};

// engine/src/facetBorderSegmenter.ts
var PathSegment = class {
  constructor(points, neighbour) {
    this.points = points;
    this.neighbour = neighbour;
  }
};
var FacetBoundarySegment = class {
  constructor(originalSegment, neighbour, reverseOrder) {
    this.originalSegment = originalSegment;
    this.neighbour = neighbour;
    this.reverseOrder = reverseOrder;
  }
};
var FacetBorderSegmenter = class _FacetBorderSegmenter {
  /**
   *  Builds border segments that are shared between facets
   *  While border paths are all nice and fancy, they are not linked to neighbour facets
   *  So any change in the paths makes a not so nice gap between the facets, which makes smoothing them out impossible
   */
  static async buildFacetBorderSegments(facetResult, nrOfTimesToHalvePoints = 2, onUpdate = null) {
    const segmentsPerFacet = _FacetBorderSegmenter.prepareSegmentsPerFacet(facetResult);
    _FacetBorderSegmenter.reduceSegmentComplexity(facetResult, segmentsPerFacet, nrOfTimesToHalvePoints);
    await _FacetBorderSegmenter.matchSegmentsWithNeighbours(facetResult, segmentsPerFacet, onUpdate);
  }
  /**
   *  Chops up the border paths per facet into segments adjacent tothe same neighbour
   */
  static prepareSegmentsPerFacet(facetResult) {
    const segmentsPerFacet = new Array(facetResult.facets.length);
    for (const f of facetResult.facets) {
      if (f != null) {
        const segments = [];
        if (f.borderPath.length > 1) {
          let currentPoints = [];
          currentPoints.push(f.borderPath[0]);
          for (let i = 1; i < f.borderPath.length; i++) {
            const prevBorderPoint = f.borderPath[i - 1];
            const curBorderPoint = f.borderPath[i];
            const oldNeighbour = prevBorderPoint.getNeighbour(facetResult);
            const curNeighbour = curBorderPoint.getNeighbour(facetResult);
            let isTransitionPoint = false;
            if (oldNeighbour !== curNeighbour) {
              isTransitionPoint = true;
            } else {
              if (oldNeighbour !== -1) {
                if (prevBorderPoint.x === curBorderPoint.x && prevBorderPoint.y === curBorderPoint.y) {
                  if (prevBorderPoint.orientation === 1 /* Top */ && curBorderPoint.orientation === 0 /* Left */ || prevBorderPoint.orientation === 0 /* Left */ && curBorderPoint.orientation === 1 /* Top */) {
                    const diagNeighbour = facetResult.facetMap.get(curBorderPoint.x - 1, curBorderPoint.y - 1);
                    if (diagNeighbour !== oldNeighbour) {
                      isTransitionPoint = true;
                    }
                  } else if (prevBorderPoint.orientation === 1 /* Top */ && curBorderPoint.orientation === 2 /* Right */ || prevBorderPoint.orientation === 2 /* Right */ && curBorderPoint.orientation === 1 /* Top */) {
                    const diagNeighbour = facetResult.facetMap.get(curBorderPoint.x + 1, curBorderPoint.y - 1);
                    if (diagNeighbour !== oldNeighbour) {
                      isTransitionPoint = true;
                    }
                  } else if (prevBorderPoint.orientation === 3 /* Bottom */ && curBorderPoint.orientation === 0 /* Left */ || prevBorderPoint.orientation === 0 /* Left */ && curBorderPoint.orientation === 3 /* Bottom */) {
                    const diagNeighbour = facetResult.facetMap.get(curBorderPoint.x - 1, curBorderPoint.y + 1);
                    if (diagNeighbour !== oldNeighbour) {
                      isTransitionPoint = true;
                    }
                  } else if (prevBorderPoint.orientation === 3 /* Bottom */ && curBorderPoint.orientation === 2 /* Right */ || prevBorderPoint.orientation === 2 /* Right */ && curBorderPoint.orientation === 3 /* Bottom */) {
                    const diagNeighbour = facetResult.facetMap.get(curBorderPoint.x + 1, curBorderPoint.y + 1);
                    if (diagNeighbour !== oldNeighbour) {
                      isTransitionPoint = true;
                    }
                  }
                }
              }
            }
            currentPoints.push(curBorderPoint);
            if (isTransitionPoint) {
              if (currentPoints.length > 1) {
                const segment = new PathSegment(currentPoints, oldNeighbour);
                segments.push(segment);
                currentPoints = [curBorderPoint];
              }
            }
          }
          if (currentPoints.length > 1) {
            const oldNeighbour = f.borderPath[f.borderPath.length - 1].getNeighbour(facetResult);
            if (segments.length > 0 && segments[0].neighbour === oldNeighbour) {
              const mergedPoints = currentPoints.concat(segments[0].points);
              segments[0].points = mergedPoints;
            } else {
              const segment = new PathSegment(currentPoints, oldNeighbour);
              segments.push(segment);
              currentPoints = [];
            }
          }
        }
        segmentsPerFacet[f.id] = segments;
      }
    }
    return segmentsPerFacet;
  }
  /**
   * Reduces each segment border path points
   */
  static reduceSegmentComplexity(facetResult, segmentsPerFacet, nrOfTimesToHalvePoints) {
    for (const f of facetResult.facets) {
      if (f != null) {
        for (const segment of segmentsPerFacet[f.id]) {
          for (let i = 0; i < nrOfTimesToHalvePoints; i++) {
            segment.points = _FacetBorderSegmenter.reduceSegmentHaarWavelet(segment.points, true, facetResult.width, facetResult.height);
          }
        }
      }
    }
  }
  /**
   *  Remove the points by taking the average per pair and using that as a new point
   *  in the reduced segment. The delta values that create the Haar wavelet are not tracked
   *  because they are unneeded.
   */
  static reduceSegmentHaarWavelet(newpath, skipOutsideBorders, width, height) {
    if (newpath.length <= 5) {
      return newpath;
    }
    const reducedPath = [];
    reducedPath.push(newpath[0]);
    for (let i = 1; i < newpath.length - 2; i += 2) {
      if (!skipOutsideBorders || skipOutsideBorders && !_FacetBorderSegmenter.isOutsideBorderPoint(newpath[i], width, height)) {
        const cx = (newpath[i].x + newpath[i + 1].x) / 2;
        const cy = (newpath[i].y + newpath[i + 1].y) / 2;
        reducedPath.push(new PathPoint(new Point(cx, cy), 0 /* Left */));
      } else {
        reducedPath.push(newpath[i]);
        reducedPath.push(newpath[i + 1]);
      }
    }
    reducedPath.push(newpath[newpath.length - 1]);
    return reducedPath;
  }
  static isOutsideBorderPoint(point, width, height) {
    return point.x === 0 || point.y === 0 || point.x === width - 1 || point.y === height - 1;
  }
  static calculateArea(path) {
    let total = 0;
    for (let i = 0; i < path.length; i++) {
      const addX = path[i].x;
      const addY = path[i === path.length - 1 ? 0 : i + 1].y;
      const subX = path[i === path.length - 1 ? 0 : i + 1].x;
      const subY = path[i].y;
      total += addX * addY * 0.5;
      total -= subX * subY * 0.5;
    }
    return Math.abs(total);
  }
  /**
   *  Matches all segments with each other between facets and their neighbour
   *  A segment matches when the start and end match or the start matches with the end and vice versa
   *  (then the segment will need to be traversed in reverse order)
   */
  static async matchSegmentsWithNeighbours(facetResult, segmentsPerFacet, onUpdate = null) {
    const MAX_DISTANCE = 4;
    for (const f of facetResult.facets) {
      if (f != null) {
        f.borderSegments = new Array(segmentsPerFacet[f.id].length);
      }
    }
    let count = 0;
    for (const f of facetResult.facets) {
      if (f != null) {
        const debug = false;
        for (let s = 0; s < segmentsPerFacet[f.id].length; s++) {
          const segment = segmentsPerFacet[f.id][s];
          if (segment != null && f.borderSegments[s] == null) {
            f.borderSegments[s] = new FacetBoundarySegment(segment, segment.neighbour, false);
            if (debug) {
              console.log("Setting facet " + f.id + " segment " + s + " to " + f.borderSegments[s]);
            }
            if (segment.neighbour !== -1) {
              const neighbourFacet = facetResult.facets[segment.neighbour];
              let matchFound = false;
              if (neighbourFacet != null) {
                const neighbourSegments = segmentsPerFacet[segment.neighbour];
                for (let ns = 0; ns < neighbourSegments.length; ns++) {
                  const neighbourSegment = neighbourSegments[ns];
                  if (neighbourSegment != null && neighbourSegment.neighbour === f.id) {
                    const segStartPoint = segment.points[0];
                    const segEndPoint = segment.points[segment.points.length - 1];
                    const nSegStartPoint = neighbourSegment.points[0];
                    const nSegEndPoint = neighbourSegment.points[neighbourSegment.points.length - 1];
                    let matchesStraight = segStartPoint.distanceTo(nSegStartPoint) <= MAX_DISTANCE && segEndPoint.distanceTo(nSegEndPoint) <= MAX_DISTANCE;
                    let matchesReverse = segStartPoint.distanceTo(nSegEndPoint) <= MAX_DISTANCE && segEndPoint.distanceTo(nSegStartPoint) <= MAX_DISTANCE;
                    if (matchesStraight && matchesReverse) {
                      if (segStartPoint.distanceTo(nSegStartPoint) + segEndPoint.distanceTo(nSegEndPoint) < segStartPoint.distanceTo(nSegEndPoint) + segEndPoint.distanceTo(nSegStartPoint)) {
                        matchesStraight = true;
                        matchesReverse = false;
                      } else {
                        matchesStraight = false;
                        matchesReverse = true;
                      }
                    }
                    if (matchesStraight) {
                      if (debug) {
                        console.log("Match found for facet " + f.id + " to neighbour " + neighbourFacet.id);
                      }
                      neighbourFacet.borderSegments[ns] = new FacetBoundarySegment(segment, f.id, false);
                      if (debug) {
                        console.log("Setting facet " + neighbourFacet.id + " segment " + ns + " to " + neighbourFacet.borderSegments[ns]);
                      }
                      segmentsPerFacet[neighbourFacet.id][ns] = null;
                      matchFound = true;
                      break;
                    } else if (matchesReverse) {
                      if (debug) {
                        console.log("Reverse match found for facet " + f.id + " to neighbour " + neighbourFacet.id);
                      }
                      neighbourFacet.borderSegments[ns] = new FacetBoundarySegment(segment, f.id, true);
                      if (debug) {
                        console.log("Setting facet " + neighbourFacet.id + " segment " + ns + " to " + neighbourFacet.borderSegments[ns]);
                      }
                      segmentsPerFacet[neighbourFacet.id][ns] = null;
                      matchFound = true;
                      break;
                    }
                  }
                }
              }
              if (!matchFound && debug) {
                console.error("No match found for segment of " + f.id + ": " + ("siding " + segment.neighbour + " " + segment.points[0] + " -> " + segment.points[segment.points.length - 1]));
              }
            }
          }
          segmentsPerFacet[f.id][s] = null;
        }
        if (count % 100 === 0) {
          await delay(0);
          if (onUpdate != null) {
            onUpdate(f.id / facetResult.facets.length);
          }
        }
      }
      count++;
    }
    if (onUpdate != null) {
      onUpdate(1);
    }
  }
};

// engine/src/facetBorderTracer.ts
var FacetBorderTracer = class _FacetBorderTracer {
  /**
   *  Traces the border path of the facet from the facet border points.
   *  Imagine placing walls around the outer side of the border points.
   */
  static async buildFacetBorderPaths(facetResult, onUpdate = null) {
    let count = 0;
    const borderMask = new BooleanArray2D(facetResult.width, facetResult.height);
    const facetProcessingOrder = facetResult.facets.filter((f) => f != null).slice(0).sort((a, b) => b.pointCount > a.pointCount ? 1 : b.pointCount < a.pointCount ? -1 : 0).map((f) => f.id);
    for (let fidx = 0; fidx < facetProcessingOrder.length; fidx++) {
      const f = facetResult.facets[facetProcessingOrder[fidx]];
      if (f != null) {
        for (const bp of f.borderPoints) {
          borderMask.set(bp.x, bp.y, true);
        }
        const xWall = new BooleanArray2D(facetResult.width + 1, facetResult.height + 1);
        const yWall = new BooleanArray2D(facetResult.width + 1, facetResult.height + 1);
        let borderStartIndex = -1;
        for (let i = 0; i < f.borderPoints.length; i++) {
          if (f.borderPoints[i].x === f.bbox.minX || f.borderPoints[i].x === f.bbox.maxX || (f.borderPoints[i].y === f.bbox.minY || f.borderPoints[i].y === f.bbox.maxY)) {
            borderStartIndex = i;
            break;
          }
        }
        const pt = new PathPoint(f.borderPoints[borderStartIndex], 0 /* Left */);
        if (pt.x - 1 < 0 || facetResult.facetMap.get(pt.x - 1, pt.y) !== f.id) {
          pt.orientation = 0 /* Left */;
        } else if (pt.y - 1 < 0 || facetResult.facetMap.get(pt.x, pt.y - 1) !== f.id) {
          pt.orientation = 1 /* Top */;
        } else if (pt.x + 1 >= facetResult.width || facetResult.facetMap.get(pt.x + 1, pt.y) !== f.id) {
          pt.orientation = 2 /* Right */;
        } else if (pt.y + 1 >= facetResult.height || facetResult.facetMap.get(pt.x, pt.y + 1) !== f.id) {
          pt.orientation = 3 /* Bottom */;
        }
        const path = _FacetBorderTracer.getPath(pt, facetResult, f, borderMask, xWall, yWall);
        f.borderPath = path;
        if (count % 100 === 0) {
          await delay(0);
          if (onUpdate != null) {
            onUpdate(fidx / facetProcessingOrder.length);
          }
        }
      }
      count++;
    }
    if (onUpdate != null) {
      onUpdate(1);
    }
  }
  /**
   * Returns a border path starting from the given point
   */
  static getPath(pt, facetResult, f, borderMask, xWall, yWall) {
    const debug = false;
    let finished = false;
    const count = 0;
    const path = [];
    _FacetBorderTracer.addPointToPath(path, pt, xWall, f, yWall);
    while (!finished) {
      if (debug) {
        console.log(pt.x + " " + pt.y + " " + pt.orientation);
      }
      const possibleNextPoints = [];
      if (pt.orientation === 0 /* Left */) {
        if ((pt.y - 1 >= 0 && facetResult.facetMap.get(pt.x, pt.y - 1) !== f.id || pt.y - 1 < 0) && !yWall.get(pt.x, pt.y)) {
          if (debug) {
            console.log("can place top _ wall at x,y");
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y), 1 /* Top */);
          possibleNextPoints.push(nextpt);
        }
        if ((pt.y + 1 < facetResult.height && facetResult.facetMap.get(pt.x, pt.y + 1) !== f.id || pt.y + 1 >= facetResult.height) && !yWall.get(pt.x, pt.y + 1)) {
          if (debug) {
            console.log("can place bottom _ wall at x,y");
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y), 3 /* Bottom */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y - 1 >= 0 && facetResult.facetMap.get(pt.x, pt.y - 1) === f.id && (pt.x - 1 < 0 || facetResult.facetMap.get(pt.x - 1, pt.y - 1) !== f.id) && borderMask.get(pt.x, pt.y - 1) && !xWall.get(pt.x, pt.y - 1)) {
          if (debug) {
            console.log(`can place left | wall at x,y-1`);
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y - 1), 0 /* Left */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y + 1 < facetResult.height && facetResult.facetMap.get(pt.x, pt.y + 1) === f.id && (pt.x - 1 < 0 || facetResult.facetMap.get(pt.x - 1, pt.y + 1) !== f.id) && borderMask.get(pt.x, pt.y + 1) && !xWall.get(pt.x, pt.y + 1)) {
          if (debug) {
            console.log("can place left | wall at x,y+1");
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y + 1), 0 /* Left */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y - 1 >= 0 && pt.x - 1 >= 0 && facetResult.facetMap.get(pt.x - 1, pt.y - 1) === f.id && borderMask.get(pt.x - 1, pt.y - 1) && !yWall.get(pt.x - 1, pt.y - 1 + 1) && !yWall.get(pt.x, pt.y)) {
          if (debug) {
            console.log("can place bottom _ wall at x-1,y-1");
          }
          const nextpt = new PathPoint(new Point(pt.x - 1, pt.y - 1), 3 /* Bottom */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y + 1 < facetResult.height && pt.x - 1 >= 0 && facetResult.facetMap.get(pt.x - 1, pt.y + 1) === f.id && borderMask.get(pt.x - 1, pt.y + 1) && !yWall.get(pt.x - 1, pt.y + 1) && !yWall.get(pt.x, pt.y + 1)) {
          if (debug) {
            console.log("can place top _ wall at x-1,y+1");
          }
          const nextpt = new PathPoint(new Point(pt.x - 1, pt.y + 1), 1 /* Top */);
          possibleNextPoints.push(nextpt);
        }
      } else if (pt.orientation === 1 /* Top */) {
        if ((pt.x - 1 >= 0 && facetResult.facetMap.get(pt.x - 1, pt.y) !== f.id || pt.x - 1 < 0) && !xWall.get(pt.x, pt.y)) {
          if (debug) {
            console.log("can place left | wall at x,y");
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y), 0 /* Left */);
          possibleNextPoints.push(nextpt);
        }
        if ((pt.x + 1 < facetResult.width && facetResult.facetMap.get(pt.x + 1, pt.y) !== f.id || pt.x + 1 >= facetResult.width) && !xWall.get(pt.x + 1, pt.y)) {
          if (debug) {
            console.log("can place right | wall at x,y");
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y), 2 /* Right */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.x - 1 >= 0 && facetResult.facetMap.get(pt.x - 1, pt.y) === f.id && (pt.y - 1 < 0 || facetResult.facetMap.get(pt.x - 1, pt.y - 1) !== f.id) && borderMask.get(pt.x - 1, pt.y) && !yWall.get(pt.x - 1, pt.y)) {
          if (debug) {
            console.log(`can place top _ wall at x-1,y`);
          }
          const nextpt = new PathPoint(new Point(pt.x - 1, pt.y), 1 /* Top */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.x + 1 < facetResult.width && facetResult.facetMap.get(pt.x + 1, pt.y) === f.id && (pt.y - 1 < 0 || facetResult.facetMap.get(pt.x + 1, pt.y - 1) !== f.id) && borderMask.get(pt.x + 1, pt.y) && !yWall.get(pt.x + 1, pt.y)) {
          if (debug) {
            console.log(`can place top _ wall at x+1,y`);
          }
          const nextpt = new PathPoint(new Point(pt.x + 1, pt.y), 1 /* Top */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y - 1 >= 0 && pt.x - 1 >= 0 && facetResult.facetMap.get(pt.x - 1, pt.y - 1) === f.id && borderMask.get(pt.x - 1, pt.y - 1) && !xWall.get(pt.x - 1 + 1, pt.y - 1) && !xWall.get(pt.x, pt.y)) {
          if (debug) {
            console.log("can place right | wall at x-1,y-1");
          }
          const nextpt = new PathPoint(new Point(pt.x - 1, pt.y - 1), 2 /* Right */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y - 1 >= 0 && pt.x + 1 < facetResult.width && facetResult.facetMap.get(pt.x + 1, pt.y - 1) === f.id && borderMask.get(pt.x + 1, pt.y - 1) && !xWall.get(pt.x + 1, pt.y - 1) && !xWall.get(pt.x + 1, pt.y)) {
          if (debug) {
            console.log("can place left |  wall at x+1,y-1");
          }
          const nextpt = new PathPoint(new Point(pt.x + 1, pt.y - 1), 0 /* Left */);
          possibleNextPoints.push(nextpt);
        }
      } else if (pt.orientation === 2 /* Right */) {
        if ((pt.y - 1 >= 0 && facetResult.facetMap.get(pt.x, pt.y - 1) !== f.id || pt.y - 1 < 0) && !yWall.get(pt.x, pt.y)) {
          if (debug) {
            console.log("can place top _ wall at x,y");
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y), 1 /* Top */);
          possibleNextPoints.push(nextpt);
        }
        if ((pt.y + 1 < facetResult.height && facetResult.facetMap.get(pt.x, pt.y + 1) !== f.id || pt.y + 1 >= facetResult.height) && !yWall.get(pt.x, pt.y + 1)) {
          if (debug) {
            console.log("can place bottom _ wall at x,y");
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y), 3 /* Bottom */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y - 1 >= 0 && facetResult.facetMap.get(pt.x, pt.y - 1) === f.id && (pt.x + 1 >= facetResult.width || facetResult.facetMap.get(pt.x + 1, pt.y - 1) !== f.id) && borderMask.get(pt.x, pt.y - 1) && !xWall.get(pt.x + 1, pt.y - 1)) {
          if (debug) {
            console.log(`can place right | wall at x,y-1`);
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y - 1), 2 /* Right */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y + 1 < facetResult.height && facetResult.facetMap.get(pt.x, pt.y + 1) === f.id && (pt.x + 1 >= facetResult.width || facetResult.facetMap.get(pt.x + 1, pt.y + 1) !== f.id) && borderMask.get(pt.x, pt.y + 1) && !xWall.get(pt.x + 1, pt.y + 1)) {
          if (debug) {
            console.log("can place right | wall at x,y+1");
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y + 1), 2 /* Right */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y - 1 >= 0 && pt.x + 1 < facetResult.width && facetResult.facetMap.get(pt.x + 1, pt.y - 1) === f.id && borderMask.get(pt.x + 1, pt.y - 1) && !yWall.get(pt.x + 1, pt.y - 1 + 1) && !yWall.get(pt.x, pt.y)) {
          if (debug) {
            console.log("can place bottom _ wall at x+1,y-1");
          }
          const nextpt = new PathPoint(new Point(pt.x + 1, pt.y - 1), 3 /* Bottom */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y + 1 < facetResult.height && pt.x + 1 < facetResult.width && facetResult.facetMap.get(pt.x + 1, pt.y + 1) === f.id && borderMask.get(pt.x + 1, pt.y + 1) && !yWall.get(pt.x + 1, pt.y + 1) && !yWall.get(pt.x, pt.y + 1)) {
          if (debug) {
            console.log("can place top _ wall at x+1,y+1");
          }
          const nextpt = new PathPoint(new Point(pt.x + 1, pt.y + 1), 1 /* Top */);
          possibleNextPoints.push(nextpt);
        }
      } else if (pt.orientation === 3 /* Bottom */) {
        if ((pt.x - 1 >= 0 && facetResult.facetMap.get(pt.x - 1, pt.y) !== f.id || pt.x - 1 < 0) && !xWall.get(pt.x, pt.y)) {
          if (debug) {
            console.log("can place left | wall at x,y");
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y), 0 /* Left */);
          possibleNextPoints.push(nextpt);
        }
        if ((pt.x + 1 < facetResult.width && facetResult.facetMap.get(pt.x + 1, pt.y) !== f.id || pt.x + 1 >= facetResult.width) && !xWall.get(pt.x + 1, pt.y)) {
          if (debug) {
            console.log("can place right | wall at x,y");
          }
          const nextpt = new PathPoint(new Point(pt.x, pt.y), 2 /* Right */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.x - 1 >= 0 && facetResult.facetMap.get(pt.x - 1, pt.y) === f.id && (pt.y + 1 >= facetResult.height || facetResult.facetMap.get(pt.x - 1, pt.y + 1) !== f.id) && borderMask.get(pt.x - 1, pt.y) && !yWall.get(pt.x - 1, pt.y + 1)) {
          if (debug) {
            console.log(`can place bottom _ wall at x-1,y`);
          }
          const nextpt = new PathPoint(new Point(pt.x - 1, pt.y), 3 /* Bottom */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.x + 1 < facetResult.width && facetResult.facetMap.get(pt.x + 1, pt.y) === f.id && (pt.y + 1 >= facetResult.height || facetResult.facetMap.get(pt.x + 1, pt.y + 1) !== f.id) && borderMask.get(pt.x + 1, pt.y) && !yWall.get(pt.x + 1, pt.y + 1)) {
          if (debug) {
            console.log(`can place bottom _ wall at x+1,y`);
          }
          const nextpt = new PathPoint(new Point(pt.x + 1, pt.y), 3 /* Bottom */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y + 1 < facetResult.height && pt.x - 1 >= 0 && facetResult.facetMap.get(pt.x - 1, pt.y + 1) === f.id && borderMask.get(pt.x - 1, pt.y + 1) && !xWall.get(pt.x - 1 + 1, pt.y + 1) && !xWall.get(pt.x, pt.y)) {
          if (debug) {
            console.log("can place right | wall at x-1,y+1");
          }
          const nextpt = new PathPoint(new Point(pt.x - 1, pt.y + 1), 2 /* Right */);
          possibleNextPoints.push(nextpt);
        }
        if (pt.y + 1 < facetResult.height && pt.x + 1 < facetResult.width && facetResult.facetMap.get(pt.x + 1, pt.y + 1) === f.id && borderMask.get(pt.x + 1, pt.y + 1) && !xWall.get(pt.x + 1, pt.y + 1) && !xWall.get(pt.x + 1, pt.y)) {
          if (debug) {
            console.log("can place left |  wall at x+1,y+1");
          }
          const nextpt = new PathPoint(new Point(pt.x + 1, pt.y + 1), 0 /* Left */);
          possibleNextPoints.push(nextpt);
        }
      }
      if (possibleNextPoints.length > 1) {
        pt = possibleNextPoints[0];
        _FacetBorderTracer.addPointToPath(path, pt, xWall, f, yWall);
      } else if (possibleNextPoints.length === 1) {
        pt = possibleNextPoints[0];
        _FacetBorderTracer.addPointToPath(path, pt, xWall, f, yWall);
      } else {
        finished = true;
      }
    }
    for (const pathPoint of path) {
      switch (pathPoint.orientation) {
        case 0 /* Left */:
          xWall.set(pathPoint.x, pathPoint.y, false);
          break;
        case 1 /* Top */:
          yWall.set(pathPoint.x, pathPoint.y, false);
          break;
        case 2 /* Right */:
          xWall.set(pathPoint.x + 1, pathPoint.y, false);
          break;
        case 3 /* Bottom */:
          yWall.set(pathPoint.x, pathPoint.y + 1, false);
          break;
      }
    }
    return path;
  }
  /**
   * Add a point to the border path and ensure the correct xWall/yWalls is set
   */
  static addPointToPath(path, pt, xWall, f, yWall) {
    path.push(pt);
    switch (pt.orientation) {
      case 0 /* Left */:
        xWall.set(pt.x, pt.y, true);
        break;
      case 1 /* Top */:
        yWall.set(pt.x, pt.y, true);
        break;
      case 2 /* Right */:
        xWall.set(pt.x + 1, pt.y, true);
        break;
      case 3 /* Bottom */:
        yWall.set(pt.x, pt.y + 1, true);
        break;
    }
  }
};

// engine/src/lib/fill.ts
function fill(x, y, width, height, visited, setFill) {
  let xx = x;
  let yy = y;
  while (true) {
    const ox = xx;
    const oy = yy;
    while (yy !== 0 && !visited(xx, yy - 1)) {
      yy--;
    }
    while (xx !== 0 && !visited(xx - 1, yy)) {
      xx--;
    }
    if (xx === ox && yy === oy) {
      break;
    }
  }
  fillCore(xx, yy, width, height, visited, setFill);
}
function fillCore(x, y, width, height, visited, setFill) {
  let lastRowLength = 0;
  do {
    let rowLength = 0;
    let sx = x;
    if (lastRowLength !== 0 && visited(x, y)) {
      do {
        if (--lastRowLength === 0) {
          return;
        }
      } while (visited(++x, y));
      sx = x;
    } else {
      for (; x !== 0 && !visited(x - 1, y); rowLength++, lastRowLength++) {
        x--;
        setFill(x, y);
        if (y !== 0 && !visited(x, y - 1)) {
          fill(x, y - 1, width, height, visited, setFill);
        }
      }
    }
    for (; sx < width && !visited(sx, y); rowLength++, sx++) {
      setFill(sx, y);
    }
    if (rowLength < lastRowLength) {
      for (const end = x + lastRowLength; ++sx < end; ) {
        if (!visited(sx, y)) {
          fillCore(sx, y, width, height, visited, setFill);
        }
      }
    } else if (rowLength > lastRowLength && y !== 0) {
      for (let ux = x + lastRowLength; ++ux < sx; ) {
        if (!visited(ux, y - 1)) {
          fill(ux, y - 1, width, height, visited, setFill);
        }
      }
    }
    lastRowLength = rowLength;
  } while (lastRowLength !== 0 && ++y < height);
}

// engine/src/structs/boundingbox.ts
var BoundingBox = class {
  constructor() {
    this.minX = Number.MAX_VALUE;
    this.minY = Number.MAX_VALUE;
    this.maxX = Number.MIN_VALUE;
    this.maxY = Number.MIN_VALUE;
  }
  get width() {
    return this.maxX - this.minX + 1;
  }
  get height() {
    return this.maxY - this.minY + 1;
  }
};

// engine/src/facetCreator.ts
var FacetCreator = class _FacetCreator {
  /**
   *  Constructs the facets with its border points for each area of pixels of the same color
   */
  static async getFacets(width, height, imgColorIndices, onUpdate = null) {
    const result = new FacetResult();
    result.width = width;
    result.height = height;
    const visited = new BooleanArray2D(result.width, result.height);
    result.facetMap = new Uint32Array2D(result.width, result.height);
    result.facets = [];
    let count = 0;
    for (let j = 0; j < result.height; j++) {
      for (let i = 0; i < result.width; i++) {
        const colorIndex = imgColorIndices.get(i, j);
        if (!visited.get(i, j)) {
          const facetIndex = result.facets.length;
          const facet = _FacetCreator.buildFacet(facetIndex, colorIndex, i, j, visited, imgColorIndices, result);
          result.facets.push(facet);
          if (count % 100 === 0) {
            await delay(0);
            if (onUpdate != null) {
              onUpdate(count / (result.width * result.height));
            }
          }
        }
        count++;
      }
    }
    await delay(0);
    for (const f of result.facets) {
      if (f != null) {
        _FacetCreator.buildFacetNeighbour(f, result);
      }
    }
    if (onUpdate != null) {
      onUpdate(1);
    }
    return result;
  }
  /**
   *  Builds a facet at given x,y using depth first search to visit all pixels of the same color
   */
  static buildFacet(facetIndex, facetColorIndex, x, y, visited, imgColorIndices, facetResult) {
    const facet = new Facet();
    facet.id = facetIndex;
    facet.color = facetColorIndex;
    facet.bbox = new BoundingBox();
    facet.borderPoints = [];
    facet.neighbourFacetsIsDirty = true;
    facet.neighbourFacets = null;
    fill(x, y, facetResult.width, facetResult.height, (ptx, pty) => visited.get(ptx, pty) || imgColorIndices.get(ptx, pty) !== facetColorIndex, (ptx, pty) => {
      visited.set(ptx, pty, true);
      facetResult.facetMap.set(ptx, pty, facetIndex);
      facet.pointCount++;
      const isInnerPoint = imgColorIndices.matchAllAround(ptx, pty, facetColorIndex);
      if (!isInnerPoint) {
        facet.borderPoints.push(new Point(ptx, pty));
      }
      if (ptx > facet.bbox.maxX) {
        facet.bbox.maxX = ptx;
      }
      if (pty > facet.bbox.maxY) {
        facet.bbox.maxY = pty;
      }
      if (ptx < facet.bbox.minX) {
        facet.bbox.minX = ptx;
      }
      if (pty < facet.bbox.minY) {
        facet.bbox.minY = pty;
      }
    });
    return facet;
  }
  /**
   * Check which neighbour facets the given facet has by checking the neighbour facets at each border point
   */
  static buildFacetNeighbour(facet, facetResult) {
    facet.neighbourFacets = [];
    const uniqueFacets = {};
    for (const pt of facet.borderPoints) {
      if (pt.x - 1 >= 0) {
        const leftFacetId = facetResult.facetMap.get(pt.x - 1, pt.y);
        if (leftFacetId !== facet.id) {
          uniqueFacets[leftFacetId] = true;
        }
      }
      if (pt.y - 1 >= 0) {
        const topFacetId = facetResult.facetMap.get(pt.x, pt.y - 1);
        if (topFacetId !== facet.id) {
          uniqueFacets[topFacetId] = true;
        }
      }
      if (pt.x + 1 < facetResult.width) {
        const rightFacetId = facetResult.facetMap.get(pt.x + 1, pt.y);
        if (rightFacetId !== facet.id) {
          uniqueFacets[rightFacetId] = true;
        }
      }
      if (pt.y + 1 < facetResult.height) {
        const bottomFacetId = facetResult.facetMap.get(pt.x, pt.y + 1);
        if (bottomFacetId !== facet.id) {
          uniqueFacets[bottomFacetId] = true;
        }
      }
    }
    for (const k of Object.keys(uniqueFacets)) {
      if (uniqueFacets.hasOwnProperty(k)) {
        facet.neighbourFacets.push(parseInt(k));
      }
    }
    facet.neighbourFacetsIsDirty = false;
  }
};

// engine/src/lib/datastructs.ts
var Map = class _Map {
  constructor() {
    this.obj = {};
  }
  containsKey(key) {
    return key in this.obj;
  }
  getKeys() {
    const keys = [];
    for (const el in this.obj) {
      if (this.obj.hasOwnProperty(el)) {
        keys.push(el);
      }
    }
    return keys;
  }
  get(key) {
    const o = this.obj[key];
    if (typeof o === "undefined") {
      return null;
    } else {
      return o;
    }
  }
  put(key, value) {
    this.obj[key] = value;
  }
  remove(key) {
    delete this.obj[key];
  }
  clone() {
    const m = new _Map();
    m.obj = {};
    for (const p in this.obj) {
      m.obj[p] = this.obj[p];
    }
    return m;
  }
};
var Heap = class _Heap {
  constructor() {
    this.array = [];
    this.keyMap = new Map();
  }
  add(obj) {
    if (this.keyMap.containsKey(obj.getKey())) {
      throw new Error("Item with key " + obj.getKey() + " already exists in the heap");
    }
    this.array.push(obj);
    this.keyMap.put(obj.getKey(), this.array.length - 1);
    this.checkParentRequirement(this.array.length - 1);
  }
  replaceAt(idx, newobj) {
    this.array[idx] = newobj;
    this.keyMap.put(newobj.getKey(), idx);
    this.checkParentRequirement(idx);
    this.checkChildrenRequirement(idx);
  }
  shift() {
    return this.removeAt(0);
  }
  remove(obj) {
    const idx = this.keyMap.get(obj.getKey());
    if (idx === -1) {
      return;
    }
    this.removeAt(idx);
  }
  removeWhere(predicate) {
    const itemsToRemove = [];
    for (let i = this.array.length - 1; i >= 0; i--) {
      if (predicate(this.array[i])) {
        itemsToRemove.push(this.array[i]);
      }
    }
    for (const el of itemsToRemove) {
      this.remove(el);
    }
    for (const el of this.array) {
      if (predicate(el)) {
        console.log("Idx of element not removed: " + this.keyMap.get(el.getKey()));
        throw new Error("element not removed: " + el.getKey());
      }
    }
  }
  removeAt(idx) {
    const obj = this.array[idx];
    this.keyMap.remove(obj.getKey());
    const isLastElement = idx === this.array.length - 1;
    if (this.array.length > 0) {
      const newobj = this.array.pop();
      if (!isLastElement && this.array.length > 0) {
        this.replaceAt(idx, newobj);
      }
    }
    return obj;
  }
  foreach(func) {
    const arr = this.array.sort((e, e2) => e.compareTo(e2));
    for (const el of arr) {
      func(el);
    }
  }
  peek() {
    return this.array[0];
  }
  contains(key) {
    return this.keyMap.containsKey(key);
  }
  at(key) {
    const obj = this.keyMap.get(key);
    if (typeof obj === "undefined") {
      return null;
    } else {
      return this.array[obj];
    }
  }
  size() {
    return this.array.length;
  }
  checkHeapRequirement(item) {
    const idx = this.keyMap.get(item.getKey());
    if (idx != null) {
      this.checkParentRequirement(idx);
      this.checkChildrenRequirement(idx);
    }
  }
  checkChildrenRequirement(idx) {
    let stop = false;
    while (!stop) {
      const left = this.getLeftChildIndex(idx);
      let right = left === -1 ? -1 : left + 1;
      if (left === -1) {
        return;
      }
      if (right >= this.size()) {
        right = -1;
      }
      let minIdx;
      if (right === -1) {
        minIdx = left;
      } else {
        minIdx = this.array[left].compareTo(this.array[right]) < 0 ? left : right;
      }
      if (this.array[idx].compareTo(this.array[minIdx]) > 0) {
        this.swap(idx, minIdx);
        idx = minIdx;
      } else {
        stop = true;
      }
    }
  }
  checkParentRequirement(idx) {
    let curIdx = idx;
    let parentIdx = _Heap.getParentIndex(curIdx);
    while (parentIdx >= 0 && this.array[parentIdx].compareTo(this.array[curIdx]) > 0) {
      this.swap(curIdx, parentIdx);
      curIdx = parentIdx;
      parentIdx = _Heap.getParentIndex(curIdx);
    }
  }
  dump() {
    if (this.size() === 0) {
      return;
    }
    const idx = 0;
    const leftIdx = this.getLeftChildIndex(idx);
    const rightIdx = leftIdx + 1;
    console.log(this.array);
    console.log("--- keymap ---");
    console.log(this.keyMap);
  }
  swap(i, j) {
    this.keyMap.put(this.array[i].getKey(), j);
    this.keyMap.put(this.array[j].getKey(), i);
    const tmp = this.array[i];
    this.array[i] = this.array[j];
    this.array[j] = tmp;
  }
  getLeftChildIndex(curIdx) {
    const idx = (curIdx + 1) * 2 - 1;
    if (idx >= this.array.length) {
      return -1;
    } else {
      return idx;
    }
  }
  static getParentIndex(curIdx) {
    if (curIdx === 0) {
      return -1;
    }
    return Math.floor((curIdx + 1) / 2) - 1;
  }
  clone() {
    const h = new _Heap();
    h.array = this.array.slice(0);
    h.keyMap = this.keyMap.clone();
    return h;
  }
};
var PriorityQueue = class _PriorityQueue {
  constructor() {
    this.heap = new Heap();
  }
  enqueue(obj) {
    this.heap.add(obj);
  }
  peek() {
    return this.heap.peek();
  }
  updatePriority(key) {
    this.heap.checkHeapRequirement(key);
  }
  get(key) {
    return this.heap.at(key);
  }
  get size() {
    return this.heap.size();
  }
  dequeue() {
    return this.heap.shift();
  }
  dump() {
    this.heap.dump();
  }
  contains(key) {
    return this.heap.contains(key);
  }
  removeWhere(predicate) {
    this.heap.removeWhere(predicate);
  }
  foreach(func) {
    this.heap.foreach(func);
  }
  clone() {
    const p = new _PriorityQueue();
    p.heap = this.heap.clone();
    return p;
  }
};

// engine/src/lib/polylabel.ts
function polylabel(polygon, precision = 1) {
  let minX = Number.MAX_VALUE;
  let minY = Number.MAX_VALUE;
  let maxX = Number.MIN_VALUE;
  let maxY = Number.MIN_VALUE;
  for (let i = 0; i < polygon[0].length; i++) {
    const p = polygon[0][i];
    if (p.x < minX) {
      minX = p.x;
    }
    if (p.y < minY) {
      minY = p.y;
    }
    if (p.x > maxX) {
      maxX = p.x;
    }
    if (p.y > maxY) {
      maxY = p.y;
    }
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  let h = cellSize / 2;
  const cellQueue = new PriorityQueue();
  if (cellSize === 0) {
    return { pt: { x: minX, y: minY }, distance: 0 };
  }
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) {
      cellQueue.enqueue(new Cell(x + h, y + h, h, polygon));
    }
  }
  let bestCell = getCentroidCell(polygon);
  const bboxCell = new Cell(minX + width / 2, minY + height / 2, 0, polygon);
  if (bboxCell.d > bestCell.d) {
    bestCell = bboxCell;
  }
  let numProbes = cellQueue.size;
  while (cellQueue.size > 0) {
    const cell = cellQueue.dequeue();
    if (cell.d > bestCell.d) {
      bestCell = cell;
    }
    if (cell.max - bestCell.d <= precision) {
      continue;
    }
    h = cell.h / 2;
    cellQueue.enqueue(new Cell(cell.x - h, cell.y - h, h, polygon));
    cellQueue.enqueue(new Cell(cell.x + h, cell.y - h, h, polygon));
    cellQueue.enqueue(new Cell(cell.x - h, cell.y + h, h, polygon));
    cellQueue.enqueue(new Cell(cell.x + h, cell.y + h, h, polygon));
    numProbes += 4;
  }
  return { pt: { x: bestCell.x, y: bestCell.y }, distance: bestCell.d };
}
var Cell = class {
  // max distance to polygon within a cell
  constructor(x, y, h, polygon) {
    this.x = x;
    this.y = y;
    this.h = h;
    this.d = pointToPolygonDist(x, y, polygon);
    this.max = this.d + this.h * Math.SQRT2;
  }
  compareTo(other) {
    return other.max - this.max;
  }
  getKey() {
    return this.x + "," + this.y;
  }
};
function getSegDistSq(px, py, a, b) {
  let x = a.x;
  let y = a.y;
  let dx = b.x - x;
  let dy = b.y - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b.x;
      y = b.y;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = px - x;
  dy = py - y;
  return dx * dx + dy * dy;
}
function pointToPolygonDist(x, y, polygon) {
  let inside = false;
  let minDistSq = Infinity;
  for (let k = 0; k < polygon.length; k++) {
    const ring = polygon[k];
    for (let i = 0, len = ring.length, j = len - 1; i < len; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > y !== b.y > y && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) {
        inside = !inside;
      }
      minDistSq = Math.min(minDistSq, getSegDistSq(x, y, a, b));
    }
  }
  return (inside ? 1 : -1) * Math.sqrt(minDistSq);
}
function getCentroidCell(polygon) {
  let area = 0;
  let x = 0;
  let y = 0;
  const points = polygon[0];
  for (let i = 0, len = points.length, j = len - 1; i < len; j = i++) {
    const a = points[i];
    const b = points[j];
    const f = a.x * b.y - b.x * a.y;
    x += (a.x + b.x) * f;
    y += (a.y + b.y) * f;
    area += f * 3;
  }
  if (area === 0) {
    return new Cell(points[0].x, points[0].y, 0, polygon);
  }
  return new Cell(x / area, y / area, 0, polygon);
}

// engine/src/facetLabelPlacer.ts
var FacetLabelPlacer = class _FacetLabelPlacer {
  /**
   *  Determines where to place the labels for each facet. This is done by calculating where
   *  in the polygon the largest circle can be contained, also called the pole of inaccessibility
   *  That's the spot where there will be the most room for the label.
   *  One tricky gotcha: neighbour facets can lay completely inside other facets and can overlap the label
   *  if only the outer border of the facet is taken in account. This is solved by adding the neighbours facet polygon that fall
   *  within the facet as additional polygon rings (why does everything look so easy to do yet never is under the hood :/)
   */
  static async buildFacetLabelBounds(facetResult, onUpdate = null) {
    let count = 0;
    for (const f of facetResult.facets) {
      if (f != null) {
        const polyRings = [];
        const borderPath = f.getFullPathFromBorderSegments(true);
        polyRings.push(borderPath);
        const onlyOuterRing = [borderPath];
        if (f.neighbourFacetsIsDirty) {
          FacetCreator.buildFacetNeighbour(f, facetResult);
        }
        for (const neighbourIdx of f.neighbourFacets) {
          const neighbourPath = facetResult.facets[neighbourIdx].getFullPathFromBorderSegments(true);
          const fallsInside = _FacetLabelPlacer.doesNeighbourFallInsideInCurrentFacet(neighbourPath, f, onlyOuterRing);
          if (fallsInside) {
            polyRings.push(neighbourPath);
          }
        }
        const result = polylabel(polyRings);
        f.labelBounds = new BoundingBox();
        const innerPadding = 2 * Math.sqrt(2 * result.distance);
        f.labelBounds.minX = result.pt.x - innerPadding;
        f.labelBounds.maxX = result.pt.x + innerPadding;
        f.labelBounds.minY = result.pt.y - innerPadding;
        f.labelBounds.maxY = result.pt.y + innerPadding;
        if (count % 100 === 0) {
          await delay(0);
          if (onUpdate != null) {
            onUpdate(f.id / facetResult.facets.length);
          }
        }
      }
      count++;
    }
    if (onUpdate != null) {
      onUpdate(1);
    }
  }
  /**
   *  Checks whether a neighbour border path is fully within the current facet border path
   */
  static doesNeighbourFallInsideInCurrentFacet(neighbourPath, f, onlyOuterRing) {
    let fallsInside = true;
    for (let i = 0; i < neighbourPath.length && fallsInside; i++) {
      if (neighbourPath[i].x >= f.bbox.minX && neighbourPath[i].x <= f.bbox.maxX && neighbourPath[i].y >= f.bbox.minY && neighbourPath[i].y <= f.bbox.maxY) {
      } else {
        fallsInside = false;
      }
    }
    if (fallsInside) {
      for (let i = 0; i < neighbourPath.length && fallsInside; i++) {
        const distance = pointToPolygonDist(neighbourPath[i].x, neighbourPath[i].y, onlyOuterRing);
        if (distance < 0) {
          fallsInside = false;
        }
      }
    }
    return fallsInside;
  }
};

// engine/src/facetReducer.ts
var FacetReducer = class _FacetReducer {
  /**
   *  Remove all facets that have a pointCount smaller than the given number.
   */
  static async reduceFacets(smallerThan, removeFacetsFromLargeToSmall, maximumNumberOfFacets, colorsByIndex, facetResult, imgColorIndices, onUpdate = null) {
    const visitedCache = new BooleanArray2D(facetResult.width, facetResult.height);
    const colorDistances = ColorReducer.buildColorDistanceMatrix(colorsByIndex);
    const facetProcessingOrder = facetResult.facets.filter((f) => f != null).slice(0).sort((a, b) => b.pointCount > a.pointCount ? 1 : b.pointCount < a.pointCount ? -1 : 0).map((f) => f.id);
    if (!removeFacetsFromLargeToSmall) {
      facetProcessingOrder.reverse();
    }
    let curTime = (/* @__PURE__ */ new Date()).getTime();
    for (let fidx = 0; fidx < facetProcessingOrder.length; fidx++) {
      const f = facetResult.facets[facetProcessingOrder[fidx]];
      if (f != null && f.pointCount < smallerThan) {
        _FacetReducer.deleteFacet(f.id, facetResult, imgColorIndices, colorDistances, visitedCache);
        if ((/* @__PURE__ */ new Date()).getTime() - curTime > 500) {
          curTime = (/* @__PURE__ */ new Date()).getTime();
          await delay(0);
          if (onUpdate != null) {
            onUpdate(0.5 * fidx / facetProcessingOrder.length);
          }
        }
      }
    }
    let facetCount = facetResult.facets.filter((f) => f != null).length;
    if (facetCount > maximumNumberOfFacets) {
      console.log(`There are still ${facetCount} facets, more than the maximum of ${maximumNumberOfFacets}. Removing the smallest facets`);
    }
    const startFacetCount = facetCount;
    while (facetCount > maximumNumberOfFacets) {
      const facetProcessingOrder2 = facetResult.facets.filter((f) => f != null).slice(0).sort((a, b) => b.pointCount > a.pointCount ? 1 : b.pointCount < a.pointCount ? -1 : 0).map((f) => f.id).reverse();
      const facetToRemove = facetResult.facets[facetProcessingOrder2[0]];
      _FacetReducer.deleteFacet(facetToRemove.id, facetResult, imgColorIndices, colorDistances, visitedCache);
      facetCount = facetResult.facets.filter((f) => f != null).length;
      if ((/* @__PURE__ */ new Date()).getTime() - curTime > 500) {
        curTime = (/* @__PURE__ */ new Date()).getTime();
        await delay(0);
        if (onUpdate != null) {
          onUpdate(0.5 + 0.5 - (facetCount - maximumNumberOfFacets) / (startFacetCount - maximumNumberOfFacets));
        }
      }
    }
    if (onUpdate != null) {
      onUpdate(1);
    }
  }
  // /**
  //  * Trims facets with narrow paths either horizontally or vertically, potentially splitting the facet into multiple facets
  //  */
  // public static trimFacets(facetResult: FacetResult, imgColorIndices: Uint8Array2D, colorDistances: number[][], visitedArrayCache: BooleanArray2D) {
  //     for (const facet of facetResult.facets) {
  //         if (facet !== null) {
  //             const facetPointsToReallocate: Point[] = [];
  //             for (let y: number = facet.bbox.minY; y <= facet.bbox.maxY; y++) {
  //                 for (let x: number = facet.bbox.minX; x <= facet.bbox.maxX; x++) {
  //                     if (x > 0 && y > 0 && x < facetResult.width - 1 && y < facetResult.height - 1 &&
  //                         facetResult.facetMap.get(x, y) === facet.id) {
  //                         // check if isolated horizontally
  //                         const top = facetResult.facetMap.get(x, y - 1);
  //                         const bottom = facetResult.facetMap.get(x, y + 1);
  //                         if (top !== facet.id && bottom !== facet.id) {
  //                             // . ? .
  //                             // . F .
  //                             // . ? .
  //                             // mark pixel of facet that it should be removed
  //                             facetPointsToReallocate.push(new Point(x, y));
  //                             const closestNeighbour = FacetReducer.getClosestNeighbourForPixel(facet, facetResult, x, y, colorDistances);
  //                             // copy over color of closest neighbour
  //                             imgColorIndices.set(x, y, facetResult.facets[closestNeighbour]!.color);
  //                             console.log("Flagged " + x + "," + y + " to trim");
  //                         }
  //                     }
  //                 }
  //             }
  //             if (facetPointsToReallocate.length > 0) {
  //                 FacetReducer.rebuildForFacetChange(visitedArrayCache, facet, imgColorIndices, facetResult);
  //             }
  //         }
  //     }
  // }
  /**
   * Deletes a facet. All points belonging to the facet are moved to the nearest neighbour facet
   * based on the distance of the neighbour border points. This results in a voronoi like filling in of the
   * void the deletion made
   */
  static deleteFacet(facetIdToRemove, facetResult, imgColorIndices, colorDistances, visitedArrayCache) {
    const facetToRemove = facetResult.facets[facetIdToRemove];
    if (facetToRemove === null) {
      return;
    }
    if (facetToRemove.neighbourFacetsIsDirty) {
      FacetCreator.buildFacetNeighbour(facetToRemove, facetResult);
    }
    if (facetToRemove.neighbourFacets.length > 0) {
      for (let j = facetToRemove.bbox.minY; j <= facetToRemove.bbox.maxY; j++) {
        for (let i = facetToRemove.bbox.minX; i <= facetToRemove.bbox.maxX; i++) {
          if (facetResult.facetMap.get(i, j) === facetToRemove.id) {
            const closestNeighbour = _FacetReducer.getClosestNeighbourForPixel(facetToRemove, facetResult, i, j, colorDistances);
            if (closestNeighbour !== -1) {
              imgColorIndices.set(i, j, facetResult.facets[closestNeighbour].color);
            } else {
              console.warn(`No closest neighbour found for point ${i},${j}`);
            }
          }
        }
      }
    } else {
      console.warn(`Facet ${facetToRemove.id} does not have any neighbours`);
    }
    _FacetReducer.rebuildForFacetChange(visitedArrayCache, facetToRemove, imgColorIndices, facetResult);
    facetResult.facets[facetToRemove.id] = null;
  }
  static rebuildForFacetChange(visitedArrayCache, facet, imgColorIndices, facetResult) {
    _FacetReducer.rebuildChangedNeighbourFacets(visitedArrayCache, facet, imgColorIndices, facetResult);
    let needsToRebuild = false;
    for (let y = facet.bbox.minY; y <= facet.bbox.maxY; y++) {
      for (let x = facet.bbox.minX; x <= facet.bbox.maxX; x++) {
        if (facetResult.facetMap.get(x, y) === facet.id) {
          console.warn(`Point ${x},${y} was reallocated to neighbours for facet ${facet.id}`);
          needsToRebuild = true;
          if (x - 1 >= 0 && facetResult.facetMap.get(x - 1, y) !== facet.id && facetResult.facets[facetResult.facetMap.get(x - 1, y)] !== null) {
            imgColorIndices.set(x, y, facetResult.facets[facetResult.facetMap.get(x - 1, y)].color);
          } else if (y - 1 >= 0 && facetResult.facetMap.get(x, y - 1) !== facet.id && facetResult.facets[facetResult.facetMap.get(x, y - 1)] !== null) {
            imgColorIndices.set(x, y, facetResult.facets[facetResult.facetMap.get(x, y - 1)].color);
          } else if (x + 1 < facetResult.width && facetResult.facetMap.get(x + 1, y) !== facet.id && facetResult.facets[facetResult.facetMap.get(x + 1, y)] !== null) {
            imgColorIndices.set(x, y, facetResult.facets[facetResult.facetMap.get(x + 1, y)].color);
          } else if (y + 1 < facetResult.height && facetResult.facetMap.get(x, y + 1) !== facet.id && facetResult.facets[facetResult.facetMap.get(x, y + 1)] !== null) {
            imgColorIndices.set(x, y, facetResult.facets[facetResult.facetMap.get(x, y + 1)].color);
          } else {
            console.error(`Unable to reallocate point ${x},${y}`);
          }
        }
      }
    }
    if (needsToRebuild) {
      _FacetReducer.rebuildChangedNeighbourFacets(visitedArrayCache, facet, imgColorIndices, facetResult);
    }
  }
  /**
   * Determines the closest neighbour for a given pixel of a facet, based on the closest distance to the neighbour AND the when tied, the closest color
   */
  static getClosestNeighbourForPixel(facetToRemove, facetResult, x, y, colorDistances) {
    let closestNeighbour = -1;
    let minDistance = Number.MAX_VALUE;
    let minColorDistance = Number.MAX_VALUE;
    if (facetToRemove.neighbourFacetsIsDirty) {
      FacetCreator.buildFacetNeighbour(facetToRemove, facetResult);
    }
    for (const neighbourIdx of facetToRemove.neighbourFacets) {
      const neighbour = facetResult.facets[neighbourIdx];
      if (neighbour != null) {
        for (const bpt of neighbour.borderPoints) {
          const distance = bpt.distanceToCoord(x, y);
          if (distance < minDistance) {
            minDistance = distance;
            closestNeighbour = neighbourIdx;
            minColorDistance = Number.MAX_VALUE;
          } else if (distance === minDistance) {
            const colorDistance = colorDistances[facetToRemove.color][neighbour.color];
            if (colorDistance < minColorDistance) {
              minColorDistance = colorDistance;
              closestNeighbour = neighbourIdx;
            }
          }
        }
      }
    }
    return closestNeighbour;
  }
  /**
   *  Rebuilds the given changed facets
   */
  static rebuildChangedNeighbourFacets(visitedArrayCache, facetToRemove, imgColorIndices, facetResult) {
    const changedNeighboursSet = {};
    if (facetToRemove.neighbourFacetsIsDirty) {
      FacetCreator.buildFacetNeighbour(facetToRemove, facetResult);
    }
    for (const neighbourIdx of facetToRemove.neighbourFacets) {
      const neighbour = facetResult.facets[neighbourIdx];
      if (neighbour != null) {
        changedNeighboursSet[neighbourIdx] = true;
        if (neighbour.neighbourFacetsIsDirty) {
          FacetCreator.buildFacetNeighbour(neighbour, facetResult);
        }
        for (const n of neighbour.neighbourFacets) {
          changedNeighboursSet[n] = true;
        }
        const newFacet = FacetCreator.buildFacet(neighbourIdx, neighbour.color, neighbour.borderPoints[0].x, neighbour.borderPoints[0].y, visitedArrayCache, imgColorIndices, facetResult);
        facetResult.facets[neighbourIdx] = newFacet;
        if (newFacet.pointCount === 0) {
          facetResult.facets[neighbourIdx] = null;
        }
      }
    }
    if (facetToRemove.neighbourFacetsIsDirty) {
      FacetCreator.buildFacetNeighbour(facetToRemove, facetResult);
    }
    for (const neighbourIdx of facetToRemove.neighbourFacets) {
      const neighbour = facetResult.facets[neighbourIdx];
      if (neighbour != null) {
        for (let y = neighbour.bbox.minY; y <= neighbour.bbox.maxY; y++) {
          for (let x = neighbour.bbox.minX; x <= neighbour.bbox.maxX; x++) {
            if (facetResult.facetMap.get(x, y) === neighbour.id) {
              visitedArrayCache.set(x, y, false);
            }
          }
        }
      }
    }
    for (const k of Object.keys(changedNeighboursSet)) {
      if (changedNeighboursSet.hasOwnProperty(k)) {
        const neighbourIdx = parseInt(k);
        const f = facetResult.facets[neighbourIdx];
        if (f != null) {
          f.neighbourFacets = null;
          f.neighbourFacetsIsDirty = true;
        }
      }
    }
  }
};

// engine/generate.ts
function gaussBlur(src, w, h) {
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const xx = x + i < 0 ? 0 : x + i >= w ? w - 1 : x + i;
        s += src[y * w + xx] * k[i + 2];
      }
      tmp[y * w + x] = s / 16;
    }
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let i = -2; i <= 2; i++) {
        const yy = y + i < 0 ? 0 : y + i >= h ? h - 1 : y + i;
        s += tmp[yy * w + x] * k[i + 2];
      }
      out[y * w + x] = s / 16;
    }
  }
  return out;
}
function canny(lum, w, h, lo, hi) {
  const b = gaussBlur(lum, w, h);
  const mag = new Float32Array(w * h);
  const dir = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -b[i - w - 1] - 2 * b[i - 1] - b[i + w - 1] + b[i - w + 1] + 2 * b[i + 1] + b[i + w + 1];
      const gy = -b[i - w - 1] - 2 * b[i - w] - b[i - w + 1] + b[i + w - 1] + 2 * b[i + w] + b[i + w + 1];
      mag[i] = Math.sqrt(gx * gx + gy * gy);
      let ang = Math.atan2(gy, gx) * 180 / Math.PI;
      if (ang < 0) ang += 180;
      dir[i] = ang < 22.5 || ang >= 157.5 ? 0 : ang < 67.5 ? 1 : ang < 112.5 ? 2 : 3;
    }
  }
  const nms = new Float32Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const m = mag[i];
      let p;
      let q;
      switch (dir[i]) {
        case 0:
          p = mag[i - 1];
          q = mag[i + 1];
          break;
        case 1:
          p = mag[i - w + 1];
          q = mag[i + w - 1];
          break;
        case 2:
          p = mag[i - w];
          q = mag[i + w];
          break;
        default:
          p = mag[i - w - 1];
          q = mag[i + w + 1];
      }
      nms[i] = m >= p && m >= q ? m : 0;
    }
  }
  const out = new Uint8Array(w * h);
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (nms[i] >= hi) {
      out[i] = 1;
      stack.push(i);
    }
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!out[j] && nms[j] >= lo) {
          out[j] = 1;
          stack.push(j);
        }
      }
    }
  }
  return out;
}
function dilateBin(bin, w, h) {
  const src = bin.slice();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (src[y * w + x]) continue;
      let on = false;
      for (let dy = -1; dy <= 1 && !on; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (src[ny * w + nx]) {
            on = true;
            break;
          }
        }
      }
      if (on) bin[y * w + x] = 1;
    }
  }
}
function median3(data, w, h) {
  const src = data.slice();
  const win = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        win.length = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            win.push(src[((y + dy) * w + (x + dx)) * 4 + c]);
          }
        }
        win.sort((a, b) => a - b);
        data[i + c] = win[4];
      }
    }
  }
}
function portraitLineArt(data, w, h, strength) {
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) lut[i] = Math.round(255 * Math.pow(i / 255, 0.72));
  for (let i = 0; i < data.length; i += 4) {
    data[i] = lut[data[i]];
    data[i + 1] = lut[data[i + 1]];
    data[i + 2] = lut[data[i + 2]];
  }
  median3(data, w, h);
  median3(data, w, h);
  const n = w * h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    lum[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
  }
  const blur = gaussBlur(lum, w, h);
  for (let i = 0; i < n; i++) {
    lum[i] = Math.max(0, Math.min(255, lum[i] + 1.7 * (lum[i] - blur[i])));
  }
  const hi = Math.max(28, 100 - 70 * strength);
  const edges = canny(lum, w, h, hi * 0.4, hi);
  dilateBin(edges, w, h);
  for (let i = 0; i < n; i++) {
    if (edges[i]) {
      data[i * 4] = 0;
      data[i * 4 + 1] = 0;
      data[i * 4 + 2] = 0;
    }
  }
}
var COLOR_SPACE = {
  rgb: 0 /* RGB */,
  hsl: 1 /* HSL */,
  lab: 2 /* LAB */
};
function preprocessPixels(data, contrast, saturation) {
  const c = contrast;
  const s = saturation;
  if (c === 1 && s === 1) return;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    if (c !== 1) {
      r = (r / 255 - 0.5) * c + 0.5;
      g = (g / 255 - 0.5) * c + 0.5;
      b = (b / 255 - 0.5) * c + 0.5;
      r *= 255;
      g *= 255;
      b *= 255;
    }
    if (s !== 1) {
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      r = luma + (r - luma) * s;
      g = luma + (g - luma) * s;
      b = luma + (b - luma) * s;
    }
    data[i] = Math.max(0, Math.min(255, r));
    data[i + 1] = Math.max(0, Math.min(255, g));
    data[i + 2] = Math.max(0, Math.min(255, b));
  }
}
function calculateMinFacetSize(fontSizeInImageSpace, paddingPct = 0.05) {
  const paddingFactor = 1 - 2 * paddingPct;
  const textWidth = 1.2 * fontSizeInImageSpace;
  const textHeight = fontSizeInImageSpace;
  const area = textWidth / paddingFactor * (textHeight / paddingFactor);
  return Math.ceil(area);
}
function getMinFacetSizeForPiece(renderMode, fontSize, sizeMultiplier, overrideMinFacetSize) {
  if (renderMode === "exact_source") {
    return 1;
  }
  if (overrideMinFacetSize !== void 0) {
    return overrideMinFacetSize;
  }
  const fontSizeInImageSpace = fontSize / sizeMultiplier;
  const baseArea = calculateMinFacetSize(fontSizeInImageSpace, 0.05);
  const multiplier = renderMode === "portrait" ? 1.5 : 2.5;
  return Math.ceil(baseArea * multiplier);
}
async function generatePaintByNumbers(imageBuffer, options) {
  if (!options || typeof options.colorCount !== "number" || options.colorCount < 2) {
    throw new Error("generatePaintByNumbers: options.colorCount must be >= 2");
  }
  if (typeof options.randomSeed !== "number") {
    throw new Error("generatePaintByNumbers: options.randomSeed is required for deterministic output");
  }
  const settings = new Settings();
  settings.kMeansNrOfClusters = options.colorCount;
  settings.randomSeed = options.randomSeed === 0 ? 1 : options.randomSeed;
  const sizeMultiplier = options.sizeMultiplier ?? 3;
  const fontSize = options.fontSize ?? 12;
  const renderMode = options.renderMode ?? "painting";
  const finalMinFacetSize = getMinFacetSizeForPiece(
    renderMode,
    fontSize,
    sizeMultiplier,
    options.minFacetSize
  );
  settings.removeFacetsSmallerThanNrOfPoints = finalMinFacetSize;
  if (typeof options.maxFacets === "number") {
    settings.maximumNumberOfFacets = options.maxFacets;
  }
  if (options.colorRestrictions) {
    settings.kMeansColorRestrictions = options.colorRestrictions;
  }
  if (renderMode === "exact_source") {
    settings.narrowPixelStripCleanupRuns = 0;
  } else if (typeof options.narrowPixelStripCleanupRuns === "number") {
    settings.narrowPixelStripCleanupRuns = options.narrowPixelStripCleanupRuns;
  }
  settings.kMeansClusteringColorSpace = COLOR_SPACE[options.clusteringColorSpace ?? "rgb"];
  settings.resizeImageIfTooLarge = true;
  if (typeof options.resizeMaxWidth === "number") settings.resizeImageWidth = options.resizeMaxWidth;
  if (typeof options.resizeMaxHeight === "number") settings.resizeImageHeight = options.resizeMaxHeight;
  const img = await nodeCanvas.loadImage(imageBuffer);
  let c = nodeCanvas.createCanvas(img.width, img.height);
  let ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, c.width, c.height);
  let imgData = ctx.getImageData(0, 0, c.width, c.height);
  if (settings.resizeImageIfTooLarge && (c.width > settings.resizeImageWidth || c.height > settings.resizeImageHeight)) {
    let width = c.width;
    let height = c.height;
    if (width > settings.resizeImageWidth) {
      const newWidth = settings.resizeImageWidth;
      const newHeight = Math.round(c.height / c.width * settings.resizeImageWidth);
      width = newWidth;
      height = newHeight;
    }
    if (height > settings.resizeImageHeight) {
      const newHeight = settings.resizeImageHeight;
      const newWidth = Math.round(width / height * newHeight);
      width = newWidth;
      height = newHeight;
    }
    const resized = nodeCanvas.createCanvas(width, height);
    const rctx = resized.getContext("2d");
    rctx.drawImage(c, 0, 0, width, height);
    c = resized;
    ctx = rctx;
    imgData = ctx.getImageData(0, 0, width, height);
  }
  if (renderMode !== "exact_source") {
    const px = imgData.data;
    const edge = options.edgeEmphasis ?? 0;
    if (edge > 0) {
      portraitLineArt(px, imgData.width, imgData.height, edge);
    }
    preprocessPixels(px, options.contrastBoost ?? 1, options.saturationBoost ?? 1);
  }
  const kCanvas = nodeCanvas.createCanvas(imgData.width, imgData.height);
  const kCtx = kCanvas.getContext("2d");
  kCtx.fillStyle = "white";
  kCtx.fillRect(0, 0, kCanvas.width, kCanvas.height);
  const kmeansImgData = kCtx.getImageData(
    0,
    0,
    kCanvas.width,
    kCanvas.height
  );
  await ColorReducer.applyKMeansClustering(imgData, kmeansImgData, ctx, settings);
  const colormapResult = ColorReducer.createColorMap(kmeansImgData);
  let facetResult = new FacetResult();
  if (!settings.narrowPixelStripCleanupRuns || settings.narrowPixelStripCleanupRuns === 0) {
    facetResult = await FacetCreator.getFacets(
      imgData.width,
      imgData.height,
      colormapResult.imgColorIndices,
      () => void 0
    );
    await FacetReducer.reduceFacets(
      settings.removeFacetsSmallerThanNrOfPoints,
      settings.removeFacetsFromLargeToSmall,
      settings.maximumNumberOfFacets,
      colormapResult.colorsByIndex,
      facetResult,
      colormapResult.imgColorIndices,
      () => void 0
    );
  } else {
    for (let run = 0; run < settings.narrowPixelStripCleanupRuns; run++) {
      await ColorReducer.processNarrowPixelStripCleanup(colormapResult);
      facetResult = await FacetCreator.getFacets(
        imgData.width,
        imgData.height,
        colormapResult.imgColorIndices,
        () => void 0
      );
      await FacetReducer.reduceFacets(
        settings.removeFacetsSmallerThanNrOfPoints,
        settings.removeFacetsFromLargeToSmall,
        settings.maximumNumberOfFacets,
        colormapResult.colorsByIndex,
        facetResult,
        colormapResult.imgColorIndices,
        () => void 0
      );
    }
  }
  await FacetBorderTracer.buildFacetBorderPaths(facetResult, () => void 0);
  await FacetBorderSegmenter.buildFacetBorderSegments(
    facetResult,
    settings.nrOfTimesToHalveBorderSegments,
    () => void 0
  );
  await FacetLabelPlacer.buildFacetLabelBounds(facetResult, () => void 0);
  const fontColor = options.fontColor ?? "#1A1A1A";
  const strokeWidth = options.strokeWidth ?? 1;
  const unifiedFontSize = options.unifiedFontSize ?? renderMode !== "exact_source";
  let base64Data;
  if (renderMode === "exact_source") {
    base64Data = c.toBuffer("image/png").toString("base64");
  }
  const filledSvg = renderSvg(
    facetResult,
    colormapResult.colorsByIndex,
    sizeMultiplier,
    /* fill */
    renderMode === "exact_source" ? false : true,
    /* stroke */
    renderMode === "exact_source" ? true : false,
    /* labels */
    renderMode === "exact_source" ? true : false,
    fontSize,
    fontColor,
    strokeWidth,
    unifiedFontSize,
    base64Data
  );
  const outlineSvg = renderSvg(
    facetResult,
    colormapResult.colorsByIndex,
    sizeMultiplier,
    /* fill */
    false,
    /* stroke */
    true,
    /* labels */
    true,
    fontSize,
    fontColor,
    strokeWidth,
    unifiedFontSize,
    void 0
  );
  const freq = colormapResult.colorsByIndex.map(() => 0);
  for (const facet of facetResult.facets) {
    if (facet !== null) freq[facet.color] += facet.pointCount;
  }
  const total = freq.reduce((a, b) => a + b, 0) || 1;
  const palette = colormapResult.colorsByIndex.map((rgb, idx) => ({
    index: idx,
    rgb: [rgb[0], rgb[1], rgb[2]],
    hex: rgbToHex(rgb),
    areaPercentage: freq[idx] / total,
    frequency: freq[idx]
  }));
  const serializedFacets = facetResult.facets.filter((f) => f !== null).map((f) => {
    const path = f.getFullPathFromBorderSegments(false);
    if (path.length > 0 && (path[0].x !== path[path.length - 1].x || path[0].y !== path[path.length - 1].y)) {
      path.push(path[0]);
    }
    return {
      id: f.id,
      color: f.color,
      path: path.map((p) => ({ x: p.x, y: p.y })),
      labelBounds: {
        minX: f.labelBounds.minX,
        minY: f.labelBounds.minY,
        width: f.labelBounds.width,
        height: f.labelBounds.height
      }
    };
  });
  const segmentationCache = {
    width: imgData.width,
    height: imgData.height,
    colorsByIndex: colormapResult.colorsByIndex,
    facets: serializedFacets
  };
  return {
    filledSvg,
    outlineSvg,
    palette,
    width: imgData.width,
    height: imgData.height,
    segmentationCache
  };
}
function renderSvg(facetResult, colorsByIndex, sizeMultiplier, fill2, stroke, addLabels, fontSize, fontColor, strokeWidth = 1, unifiedFontSize = true, backgroundImageBase64) {
  const xmlns = "http://www.w3.org/2000/svg";
  const svgWidth = sizeMultiplier * facetResult.width;
  const svgHeight = sizeMultiplier * facetResult.height;
  let svg = `<?xml version="1.0" standalone="no"?>
<svg width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}" xmlns="${xmlns}">`;
  if (backgroundImageBase64) {
    svg += `
<image href="data:image/png;base64,${backgroundImageBase64}" x="0" y="0" width="${svgWidth}" height="${svgHeight}" opacity="1.0" style="pointer-events: none;" />`;
  }
  for (const f of facetResult.facets) {
    if (f == null) continue;
    if (!("path" in f) && f.borderSegments.length === 0) continue;
    let path;
    if ("path" in f) {
      path = f.path;
    } else {
      path = f.getFullPathFromBorderSegments(false);
      if (path[0].x !== path[path.length - 1].x || path[0].y !== path[path.length - 1].y) {
        path.push(path[0]);
      }
    }
    let d = `M ${path[0].x * sizeMultiplier} ${path[0].y * sizeMultiplier} `;
    for (let i = 1; i < path.length; i++) {
      const midX = (path[i].x + path[i - 1].x) / 2;
      const midY = (path[i].y + path[i - 1].y) / 2;
      d += `Q ${midX * sizeMultiplier} ${midY * sizeMultiplier} ${path[i].x * sizeMultiplier} ${path[i].y * sizeMultiplier} `;
    }
    const rgb = colorsByIndex[f.color];
    const rgbStr = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`;
    const fillStr = fill2 ? rgbStr : "none";
    const strokeStr = stroke ? "#000" : fill2 ? rgbStr : "";
    let style = `fill: ${fillStr};`;
    if (strokeStr) style += ` stroke: ${strokeStr}; stroke-width:${strokeWidth}px`;
    svg += `<path data-facetId="${f.id}" d="${d}" style="${style}"></path>`;
    if (addLabels) {
      const ox = f.labelBounds.minX * sizeMultiplier;
      const oy = f.labelBounds.minY * sizeMultiplier;
      const lw = f.labelBounds.width * sizeMultiplier;
      const lh = f.labelBounds.height * sizeMultiplier;
      const digits = String(f.color).length;
      let computedFontSize = fontSize;
      if (unifiedFontSize) {
        const maxWidth = lw * 0.9 / (digits * 0.6);
        const maxHeight = lh * 0.9;
        computedFontSize = Math.min(fontSize, maxWidth, maxHeight);
        computedFontSize = Math.max(1, computedFontSize);
      } else {
        computedFontSize = fontSize / digits;
      }
      const cx = ox + lw / 2;
      const cy = oy + lh / 2;
      svg += `<g class="label" data-facetId="${f.id}" data-color-index="${f.color}" transform="translate(${cx},${cy})"><text x="0" y="0" font-family="Tahoma" font-size="${computedFontSize}" dominant-baseline="middle" text-anchor="middle" fill="${fontColor}">${f.color}</text></g>`;
    }
  }
  svg += `</svg>`;
  return svg;
}
function rgbToHex(rgb) {
  return "#" + rgb.slice(0, 3).map(
    (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")
  ).join("");
}

// src/lib/paintMath.ts
var COVERAGE_FACTOR_ML_PER_CM2_PER_COAT = 0.05;
var SAFETY_MARGIN = 1.15;
function estimateVolumeMl(o) {
  const cm2 = o.areaPercentage * o.canvasWidthCm * o.canvasHeightCm;
  const raw = cm2 * o.coats * COVERAGE_FACTOR_ML_PER_CM2_PER_COAT * SAFETY_MARGIN;
  return roundUpCents(raw);
}
function roundUpCents(v) {
  return Math.ceil(v * 100) / 100;
}

// api/_lib/run-job.ts
var SOURCE_BUCKET = "source-images";
var PREVIEW_BUCKET = "piece-previews";
var OUTLINE_BUCKET = "piece-outlines";
async function runGenerationJob(admin, pieceId, opts = {}) {
  const startedAt = Date.now();
  const { data: piece, error: pieceErr } = await admin.from("pieces").select("*").eq("id", pieceId).maybeSingle();
  if (pieceErr) throw new Error(`Load piece: ${pieceErr.message}`);
  if (!piece) throw new Error(`Piece ${pieceId} not found`);
  if (piece.status !== "queued") {
    throw new Error(`Piece ${pieceId} status is '${piece.status}', not 'queued'`);
  }
  const { data: source, error: srcErr } = await admin.from("source_images").select("*").eq("id", piece.source_image_id).maybeSingle();
  if (srcErr) throw new Error(`Load source image: ${srcErr.message}`);
  if (!source) throw new Error(`Source image ${piece.source_image_id} not found`);
  const dl = await admin.storage.from(SOURCE_BUCKET).download(source.storage_path);
  if (dl.error || !dl.data) {
    throw new Error(`Download source: ${dl.error?.message ?? "no data"}`);
  }
  const buf = Buffer.from(await dl.data.arrayBuffer());
  const seed = derivePieceSeed(piece.id);
  const renderMode = piece.render_mode ?? "painting";
  const portrait = renderMode === "portrait";
  const exactSource = renderMode === "exact_source";
  let strokeWidth = piece.stroke_width ?? 1;
  if (strokeWidth === 1) {
    const canvasSizeCm = Math.max(piece.canvas_width_cm, piece.canvas_height_cm);
    strokeWidth = Math.max(0.5, Math.min(2, canvasSizeCm / 40 * 1));
  }
  const envEdge = Number(process.env.CONVERTER_MAX_EDGE);
  const resizeMaxEdge = opts.resizeMaxEdge ?? (Number.isFinite(envEdge) && envEdge > 0 ? envEdge : 512);
  const genOptions = {
    colorCount: piece.color_count,
    randomSeed: seed,
    renderMode,
    strokeWidth,
    fontSize: 12,
    // Exact source skips chunk pruning and cleanup inside the engine.
    // If undefined, the engine calculates the minFacetSize dynamically based on the font size.
    minFacetSize: exactSource ? void 0 : opts.minFacetSize,
    maxFacets: opts.maxFacets ?? (portrait ? 3500 : 3e3),
    // Portrait keeps the thin contour lines: 0 = skip narrow-strip cleanup,
    // which would otherwise erase them into dashes.
    // exact_source mode handles this inside the engine (forces 0).
    narrowPixelStripCleanupRuns: portrait ? 0 : 1,
    resizeMaxWidth: resizeMaxEdge,
    resizeMaxHeight: resizeMaxEdge,
    clusteringColorSpace: portrait ? "lab" : "rgb",
    contrastBoost: portrait ? 1.1 : 1,
    saturationBoost: portrait ? 1.1 : 1,
    // Portrait line-art: Canny contours burned black + flattened fills. Tune
    // line density live with CONVERTER_EDGE (0..1, higher = more lines).
    edgeEmphasis: portrait ? portraitEdgeStrength() : 0,
    // Exact source: unified font sizing is off so labels render at the fixed
    // base fontSize (the engine already handles this via its default).
    unifiedFontSize: exactSource ? false : true
  };
  const origLog = console.log;
  const origWarn = console.warn;
  const origInfo = console.info;
  console.log = () => {
  };
  console.warn = () => {
  };
  console.info = () => {
  };
  let result;
  try {
    result = await generatePaintByNumbers(buf, genOptions);
  } finally {
    console.log = origLog;
    console.warn = origWarn;
    console.info = origInfo;
  }
  const previewPath = `${piece.id}/filled.svg`;
  const outlinePath = `${piece.id}/outline.svg`;
  const cachePath = `${piece.id}/segmentation_cache.json`;
  const upPreview = await admin.storage.from(PREVIEW_BUCKET).upload(previewPath, result.filledSvg, {
    contentType: "image/svg+xml",
    upsert: true
  });
  if (upPreview.error) throw new Error(`Upload preview: ${upPreview.error.message}`);
  const upCache = await admin.storage.from(PREVIEW_BUCKET).upload(cachePath, JSON.stringify(result.segmentationCache), {
    contentType: "application/json",
    upsert: true
  });
  if (upCache.error) throw new Error(`Upload cache: ${upCache.error.message}`);
  const upOutline = await admin.storage.from(OUTLINE_BUCKET).upload(outlinePath, result.outlineSvg, {
    contentType: "image/svg+xml",
    upsert: true
  });
  if (upOutline.error) throw new Error(`Upload outline: ${upOutline.error.message}`);
  const paletteJson = result.palette.map((p) => ({
    index: p.index,
    color: p.hex,
    areaPercentage: p.areaPercentage,
    frequency: p.frequency
  }));
  const colorRows = result.palette.map((p) => ({
    piece_id: piece.id,
    color_index: p.index,
    label: null,
    rgb_hex: p.hex,
    area_percentage: p.areaPercentage,
    estimated_volume_ml: estimateVolumeMl({
      areaPercentage: p.areaPercentage,
      canvasWidthCm: piece.canvas_width_cm,
      canvasHeightCm: piece.canvas_height_cm,
      coats: piece.coats
    })
  }));
  const delCols = await admin.from("piece_colors").delete().eq("piece_id", piece.id);
  if (delCols.error) throw new Error(`Clear piece_colors: ${delCols.error.message}`);
  if (colorRows.length > 0) {
    const insCols = await admin.from("piece_colors").insert(colorRows);
    if (insCols.error) throw new Error(`Insert piece_colors: ${insCols.error.message}`);
  }
  const upd = await admin.from("pieces").update({
    status: "ready",
    preview_svg_path: upPreview.data.path,
    outline_svg_path: upOutline.data.path,
    palette_json: paletteJson,
    error_message: null
  }).eq("id", piece.id);
  if (upd.error) throw new Error(`Mark ready: ${upd.error.message}`);
  return {
    pieceId: piece.id,
    previewPath: upPreview.data.path,
    outlinePath: upOutline.data.path,
    paletteSize: result.palette.length,
    durationMs: Date.now() - startedAt
  };
}
async function markPieceError(admin, pieceId, message) {
  try {
    await admin.from("pieces").update({ status: "error", error_message: message.slice(0, 1e3) }).eq("id", pieceId);
  } catch {
  }
}
function portraitEdgeStrength() {
  const v = Number(process.env.CONVERTER_EDGE);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.8;
}
function derivePieceSeed(pieceId) {
  let h = 2166136261;
  for (let i = 0; i < pieceId.length; i++) {
    h ^= pieceId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 1;
}

// server/routes/generate.ts
var config = { maxDuration: 300 };
function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const body = (typeof req.body === "string" ? safeParse(req.body) : req.body) ?? {};
  const pieceId = String(body.pieceId ?? "").trim();
  if (!pieceId) return res.status(400).json({ error: "pieceId required" });
  const authHeader = req.headers.authorization ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  let admin;
  try {
    const uid = await verifyToken(token);
    admin = getAdmin(uid);
  } catch (err) {
    return res.status(401).json({ error: err instanceof Error ? err.message : "Invalid session" });
  }
  const piece = await admin.from("pieces").select("id").eq("id", pieceId).maybeSingle();
  if (piece.error) return res.status(500).json({ error: piece.error.message });
  if (!piece.data) return res.status(404).json({ error: "Piece not found" });
  try {
    const result = await runGenerationJob(admin, pieceId);
    return res.status(200).json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[generate] piece ${pieceId} failed:`, err);
    await markPieceError(admin, pieceId, message);
    return res.status(500).json({ ok: false, error: message });
  }
}
export {
  config,
  handler as default
};

import { supabase } from './supabase';

export interface CreatePieceArgs {
  file: File;
  title: string;
  colorCount: number;
  canvasWidthCm: number;
  canvasHeightCm: number;
  coats: number;
  mode?: 'auto' | 'manual';
  complexity?: 'simple' | 'normal' | 'complex';
}

export interface CreatePieceResult {
  pieceId: string;
  sourceImageId: string;
}

/**
 * Upload a source image, insert source_images + pieces rows, and fire the
 * /api/generate endpoint. Returns the new piece id so the caller can route
 * to the job view and subscribe to status updates.
 */
export async function createPieceFromUpload(args: CreatePieceArgs): Promise<CreatePieceResult> {
  const { data: who, error: whoErr } = await supabase.auth.getUser();
  if (whoErr) throw whoErr;
  const user = who?.user;
  if (!user) throw new Error('Not signed in.');

  const safeName = args.file.name.replace(/[^\w.\- ]/g, '_');
  const storagePath = `${user.id}/${crypto.randomUUID()}-${safeName}`;
  const upload = await supabase.storage
    .from('source-images')
    .upload(storagePath, args.file, {
      contentType: args.file.type || 'image/png',
      upsert: false,
    });
  if (upload.error) throw upload.error;

  const { data: source, error: srcErr } = await supabase
    .from('source_images')
    .insert({
      storage_path: storagePath,
      original_filename: args.file.name,
      uploaded_by: user.id,
    })
    .select('id')
    .single();
  if (srcErr) throw srcErr;

  const { data: piece, error: pieceErr } = await supabase
    .from('pieces')
    .insert({
      source_image_id: source.id,
      title: args.title || args.file.name,
      status: 'queued',
      mode: args.mode ?? 'auto',
      complexity: args.complexity ?? 'normal',
      color_count: args.colorCount,
      canvas_width_cm: args.canvasWidthCm,
      canvas_height_cm: args.canvasHeightCm,
      coats: args.coats,
    })
    .select('id')
    .single();
  if (pieceErr) throw pieceErr;

  // Fire the serverless trigger. We forward the user's access token so the
  // handler can refuse anonymous requests even though it uses the service
  // role internally.
  const session = await supabase.auth.getSession();
  const accessToken = session.data.session?.access_token;
  if (!accessToken) throw new Error('No access token to invoke /api/generate.');

  // Don't await the response: the UI subscribes to status changes instead.
  // We still surface a thrown error if the fetch fails outright.
  void fetch('/api/generate', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ pieceId: piece.id }),
  }).catch((err) => {
    console.warn('[createPieceFromUpload] /api/generate fetch failed:', err);
  });

  return { pieceId: piece.id, sourceImageId: source.id };
}

export async function signedUrl(bucket: string, path: string, expiresSec = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresSec);
  if (error) throw error;
  return data.signedUrl;
}

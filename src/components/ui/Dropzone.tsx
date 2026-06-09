import { ChangeEvent, DragEvent, useRef, useState } from 'react';
import { cn } from '../../lib/cn';

export interface DropzoneProps {
  onFile: (file: File) => void;
  accept?: string;
  /** Pre-selected file, for showing a preview row. */
  selected?: File | null;
  /** Optional preview image URL (e.g. an object URL created by the caller). */
  previewUrl?: string | null;
  className?: string;
}

/**
 * Drag-and-drop image picker that doubles as a tap target on touch devices.
 * Renders the cream sticker surface so it matches the rest of the intake form.
 */
export default function Dropzone({
  onFile,
  accept = 'image/png,image/jpeg,image/webp',
  selected,
  previewUrl,
  className,
}: DropzoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [over, setOver] = useState(false);

  function pick(file: File | undefined) {
    if (!file) return;
    onFile(file);
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    pick(e.target.files?.[0]);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files?.[0]);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={cn(
        'block w-full cursor-pointer text-left',
        'border-thick rounded-lg p-6 transition-all duration-fast ease-squish',
        'focus-visible:outline-none focus-visible:shadow-focus',
        over
          ? 'border-mustard bg-cream-50 shadow-sticker'
          : 'border-ink-900 bg-cream-100 shadow-sticker-sm',
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={onChange}
        className="sr-only"
      />
      {selected && previewUrl ? (
        <div className="flex items-center gap-4">
          <img
            src={previewUrl}
            alt={selected.name}
            className="h-24 w-24 object-cover rounded-md border-thick border-ink-900"
          />
          <div className="flex-1 min-w-0">
            <div className="font-display font-bold text-text-on-light truncate">
              {selected.name}
            </div>
            <div className="pl-label text-text-on-light-muted mt-1">
              {(selected.size / 1024).toFixed(0)} kB · click to change
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="font-display font-bold text-h2 text-text-on-light">
            Drop an image here
          </span>
          <span className="pl-label text-text-on-light-muted">
            png · jpg · webp · or click to pick one
          </span>
        </div>
      )}
    </div>
  );
}

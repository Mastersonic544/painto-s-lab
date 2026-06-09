import { Link } from 'react-router-dom';
import Button from '../components/ui/Button';

export default function Dashboard() {
  return (
    <div className="flex flex-col gap-6 max-w-container-md">
      <div>
        <span className="pl-label text-mustard-soft">Operator console</span>
        <h1 className="font-display font-bold text-display-sm text-cream-50 mt-2">
          Welcome back, painter.
        </h1>
      </div>

      <div className="grid sm:grid-cols-2 gap-6">
        <article className="pl-paper pl-sticker p-6">
          <span className="pl-label text-text-on-light-muted">Queued</span>
          <div className="font-mono font-bold text-h1 text-text-on-light mt-1">0</div>
          <p className="text-text-on-light mt-2">Pieces waiting on the converter.</p>
        </article>
        <article className="pl-paper pl-sticker p-6">
          <span className="pl-label text-text-on-light-muted">Approved</span>
          <div className="font-mono font-bold text-h1 text-text-on-light mt-1">0</div>
          <p className="text-text-on-light mt-2">Sitting in the Hub, ready to batch.</p>
        </article>
      </div>

      <div className="border-thick border-cream-200 rounded-lg p-6 bg-surface-raised flex flex-col gap-3 items-start">
        <h2 className="font-display font-bold text-h2 text-cream-50">Next up</h2>
        <p className="text-cream-200">
          Image intake, the approval slider, and the verified-recipe loop. The conversion engine is
          the product.
        </p>
        <Link to="/app/intake">
          <Button size="md">Start a new piece</Button>
        </Link>
      </div>
    </div>
  );
}

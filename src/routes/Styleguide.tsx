import { useState } from 'react';
import Button from '../components/ui/Button';
import IconButton from '../components/ui/IconButton';
import Card, { CardEyebrow, CardHeader, CardTitle } from '../components/ui/Card';
import Badge from '../components/ui/Badge';
import Tag from '../components/ui/Tag';
import Pill from '../components/ui/Pill';
import Input from '../components/ui/Input';
import Textarea from '../components/ui/Textarea';
import Select from '../components/ui/Select';
import Checkbox from '../components/ui/Checkbox';
import Radio from '../components/ui/Radio';
import Switch from '../components/ui/Switch';
import { Tab, TabList, TabPanel, Tabs } from '../components/ui/Tabs';
import Dialog from '../components/ui/Dialog';
import { ToastProvider, useToast } from '../components/ui/Toast';
import Tooltip from '../components/ui/Tooltip';
import ProgressBar from '../components/ui/ProgressBar';
import Spinner from '../components/ui/Spinner';
import LiquidContainer from '../components/ui/LiquidContainer';
import Blob from '../components/decorative/Blob';
import Splat from '../components/decorative/Splat';

function Section({ title, slug, children }: { title: string; slug: string; children: React.ReactNode }) {
  return (
    <section id={slug} className="flex flex-col gap-4 scroll-mt-20">
      <h2 className="font-display font-bold text-h1 text-cream-50">{title}</h2>
      <div className="border-thick border-cream-200 rounded-lg p-6 bg-surface-raised">
        <div className="flex flex-wrap items-start gap-6">{children}</div>
      </div>
    </section>
  );
}

function ToastDemo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-3">
      <Button variant="secondary" onClick={() => toast({ tone: 'success', title: 'Mix saved', description: 'Recipe verified.' })}>
        success
      </Button>
      <Button variant="primary" onClick={() => toast({ tone: 'warning', title: 'Low stock', description: 'Mustard below threshold.' })}>
        warning
      </Button>
      <Button variant="tertiary" onClick={() => toast({ tone: 'danger', title: 'Generation failed' })}>
        danger
      </Button>
      <Button variant="ghost" onClick={() => toast({ tone: 'info', title: 'Heads up', description: 'Round up, never down.' })}>
        info
      </Button>
    </div>
  );
}

export default function Styleguide() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [progress, setProgress] = useState(38);
  const [pill, setPill] = useState<'simple' | 'normal' | 'complex'>('normal');

  return (
    <ToastProvider>
      <div className="max-w-container-lg mx-auto px-6 py-10 flex flex-col gap-10">
        <header className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <span className="pl-label text-mustard-soft">dev only</span>
            <h1 className="font-display font-black text-display-md text-cream-50 mt-2">
              Painto's Lab styleguide
            </h1>
            <p className="text-cream-200 mt-1 max-w-xl">
              Every primitive in its key states. Buttons should squish on press; the LiquidContainer
              responds to device tilt on a phone.
            </p>
          </div>
          <nav className="flex flex-wrap gap-2 pl-label">
            {['buttons', 'forms', 'tabs', 'overlays', 'progress', 'liquid', 'decorative'].map((s) => (
              <a key={s} href={`#${s}`} className="text-cream-200 hover:text-mustard-soft">
                {s}
              </a>
            ))}
          </nav>
        </header>

        {/* BUTTONS */}
        <Section title="Buttons" slug="buttons">
          <div className="flex flex-col gap-4">
            <span className="pl-label text-cream-200">Variants</span>
            <div className="flex flex-wrap gap-3">
              <Button variant="primary">Primary</Button>
              <Button variant="secondary">Secondary</Button>
              <Button variant="tertiary">Tertiary</Button>
              <Button variant="ghost">Ghost</Button>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <span className="pl-label text-cream-200">Sizes</span>
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <span className="pl-label text-cream-200">States</span>
            <div className="flex flex-wrap items-center gap-3">
              <Button>Default</Button>
              <Button disabled>Disabled</Button>
              <Button loading>Loading</Button>
              <Button leftIcon={<span aria-hidden>✚</span>}>With icon</Button>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <span className="pl-label text-cream-200">IconButton</span>
            <div className="flex items-center gap-3">
              <IconButton label="Add" size="sm">+</IconButton>
              <IconButton label="Approve" size="md" variant="secondary">✓</IconButton>
              <IconButton label="Reject" size="lg" variant="tertiary">×</IconButton>
              <IconButton label="More" variant="ghost">⋯</IconButton>
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <span className="pl-label text-cream-200">Pills (segmented)</span>
            <div className="flex flex-wrap gap-2">
              {(['simple', 'normal', 'complex'] as const).map((t) => (
                <Pill key={t} active={pill === t} onClick={() => setPill(t)}>
                  {t}
                </Pill>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-4">
            <span className="pl-label text-cream-200">Badges & Tags</span>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="mustard">8 queued</Badge>
              <Badge tone="teal">ready</Badge>
              <Badge tone="terracotta">low stock</Badge>
              <Badge tone="olive">approved</Badge>
              <Badge tone="plum">archived</Badge>
              <Badge tone="cream">draft</Badge>
              <Tag>mossy heron</Tag>
              <Tag onRemove={() => undefined}>16 colors</Tag>
            </div>
          </div>
        </Section>

        {/* FORMS */}
        <Section title="Form controls" slug="forms">
          <div className="flex flex-col gap-3 w-72">
            <Input label="Piece title" placeholder="Mossy heron" />
            <Input label="Canvas width" trailingAddon="cm" defaultValue="40" />
            <Input label="Volume" leadingAddon="ml" defaultValue="120" />
            <Input label="With error" defaultValue="bad" error="Use a number." />
            <Input label="Disabled" disabled defaultValue="locked" />
          </div>
          <div className="flex flex-col gap-3 w-72">
            <Textarea label="Notes" placeholder="Friendlier on the eyes…" />
            <Select
              label="Mode"
              defaultValue="auto"
              options={[
                { label: 'Auto', value: 'auto' },
                { label: 'Manual', value: 'manual' },
              ]}
            />
            <Select
              label="Complexity"
              placeholder="Pick a tier"
              options={[
                { label: 'Simple (8)', value: 'simple' },
                { label: 'Normal (16)', value: 'normal' },
                { label: 'Complex (32)', value: 'complex' },
              ]}
            />
          </div>
          <div className="flex flex-col gap-3">
            <span className="pl-label text-cream-200">Toggles</span>
            <Checkbox label="Always round up" defaultChecked />
            <Checkbox label="Use verified recipes only" hint="Bias generator toward known mixes." />
            <Checkbox label="Disabled" disabled />
            <Radio name="coats" label="One coat" />
            <Radio name="coats" label="Two coats (default)" defaultChecked />
            <Switch label="Auto-approve at 95% confidence" defaultChecked />
            <Switch label="Tilt-aware containers" />
          </div>
        </Section>

        {/* TABS */}
        <Section title="Tabs" slug="tabs">
          <Tabs defaultValue="preview" className="w-full">
            <TabList>
              <Tab value="preview">Preview</Tab>
              <Tab value="outline">Outline</Tab>
              <Tab value="palette">Palette</Tab>
            </TabList>
            <TabPanel value="preview">
              <Card className="mt-2">
                <CardEyebrow>filled SVG</CardEyebrow>
                <CardTitle>Finished piece</CardTitle>
              </Card>
            </TabPanel>
            <TabPanel value="outline">
              <Card className="mt-2">
                <CardEyebrow>borders + labels</CardEyebrow>
                <CardTitle>Numbered template</CardTitle>
              </Card>
            </TabPanel>
            <TabPanel value="palette">
              <Card className="mt-2">
                <CardEyebrow>palette JSON</CardEyebrow>
                <CardTitle>16 colors, two coats</CardTitle>
              </Card>
            </TabPanel>
          </Tabs>
        </Section>

        {/* OVERLAYS */}
        <Section title="Overlays" slug="overlays">
          <div className="flex flex-wrap gap-3 items-center">
            <Button onClick={() => setDialogOpen(true)}>Open dialog</Button>
            <Tooltip content="Round up. Never down.">
              <Button variant="ghost">Hover me</Button>
            </Tooltip>
            <Tooltip content="Recipe verified" side="bottom">
              <Badge tone="teal">teal recipe</Badge>
            </Tooltip>
          </div>
          <ToastDemo />
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title="Approve this piece?"
            description="Adds it to the Hub. You can still edit before checkout."
            footer={
              <>
                <Button variant="ghost" onClick={() => setDialogOpen(false)}>Not yet</Button>
                <Button onClick={() => setDialogOpen(false)}>Approve</Button>
              </>
            }
          >
            <div className="flex gap-2 mt-2">
              <span className="h-7 w-7 rounded-full border border-ink-900 bg-olive" />
              <span className="h-7 w-7 rounded-full border border-ink-900 bg-mustard" />
              <span className="h-7 w-7 rounded-full border border-ink-900 bg-terracotta" />
              <span className="h-7 w-7 rounded-full border border-ink-900 bg-teal" />
            </div>
          </Dialog>
        </Section>

        {/* PROGRESS */}
        <Section title="Progress & loading" slug="progress">
          <div className="flex flex-col gap-4 w-80">
            <ProgressBar value={progress} label="Generation" tone="teal" />
            <ProgressBar value={68} label="Mustard stock" tone="mustard" />
            <ProgressBar value={18} label="Terracotta stock" tone="terracotta" />
            <div className="flex gap-3">
              <Button size="sm" variant="ghost" onClick={() => setProgress((p) => Math.max(0, p - 10))}>
                −10
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
                +10
              </Button>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <Spinner size="sm" />
            <Spinner size="md" />
            <Spinner size="lg" />
          </div>
        </Section>

        {/* LIQUID */}
        <Section title="LiquidContainer" slug="liquid">
          <LiquidContainer label="Mustard" color="var(--mustard)" currentMl={420} capacityMl={500} />
          <LiquidContainer label="Teal" color="var(--teal)" currentMl={120} capacityMl={500} />
          <LiquidContainer label="Terracotta" color="var(--terracotta)" fillPct={12} />
          <LiquidContainer label="Olive" color="var(--olive)" fillPct={78} />
        </Section>

        {/* DECORATIVE */}
        <Section title="Decorative" slug="decorative">
          <div className="flex flex-wrap items-end gap-4">
            <Blob shape={1} color="olive" />
            <Blob shape={2} color="terracotta" outlined />
            <Blob shape={3} color="plum" size={120} />
            <Blob shape="soft" color="clay-pink" outlined size={140} />
          </div>
          <div className="flex flex-wrap gap-4">
            <Splat color="mustard" />
            <Splat color="teal" outlined={false} />
            <Splat color="terracotta" size={140} />
          </div>
          <Card tilt={-2} className="max-w-sm">
            <CardHeader>
              <CardEyebrow>sample card</CardEyebrow>
              <CardTitle>Mossy heron, 16 colors</CardTitle>
            </CardHeader>
            <p>
              Cream paper, ink outline, sticker shadow. Tilted slightly for tactile feel. Round up,
              never down.
            </p>
          </Card>
        </Section>
      </div>
    </ToastProvider>
  );
}

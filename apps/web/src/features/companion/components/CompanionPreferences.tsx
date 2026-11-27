import { DEFAULT_COMPANION_MODE, type CompanionMode } from '@slider/shared';
import { useId } from 'react';
import { useMe, useSetCompanion } from '@/lib/api';
import { Section, SegmentedControl, type ShowToast } from '@/ui';

const SEGMENTS = [
  { value: 'auto', label: 'Automatisch' },
  { value: 'ask', label: 'Fragen' },
  { value: 'never', label: 'Nie' },
] as const satisfies readonly { value: CompanionMode; label: string }[];

/**
 * „Handy als Begleiter“ in `/einstellungen`: while one works at the computer, the phone beside it
 * shows what goes with the page there – by itself, offered by a sign beside the date in the
 * phone's header, or never. Kept with the account.
 */
export function CompanionPreferences({ onNotify }: { onNotify: ShowToast }) {
  const mode = useMe().data?.user?.companion ?? DEFAULT_COMPANION_MODE;
  const set = useSetCompanion();
  const labelId = useId();
  return (
    <Section
      id="begleiter"
      title="Handy als Begleiter"
      description="Arbeitest du am Computer, zeigt das Handy daneben, was zur Seite dort gehört – bei einer Mail die KI zur Mail, bei einem Termin den Termin, bei einer Präsentation die Kommentare der Folie – und du sprichst dort mit der KI darüber. Der Bildschirm bleibt dabei an. Gilt auf allen deinen Geräten."
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span id={labelId} className="text-sm text-fg">
          Begleiter öffnen
          <span className="block text-xs text-fg-subtle">
            {mode === 'auto'
              ? 'Von selbst, sobald du am Computer arbeitest'
              : mode === 'ask'
                ? 'Ein Zeichen oben neben dem Datum bietet ihn an'
                : 'Das Handy bleibt, wie es ist'}
          </span>
        </span>
        <SegmentedControl
          label="Begleiter öffnen"
          size="sm"
          track="soft"
          segments={SEGMENTS}
          value={mode}
          onChange={(value) =>
            set.mutate(value, {
              onError: () => onNotify('Einstellung konnte nicht gespeichert werden.', 'danger'),
            })
          }
        />
      </div>
    </Section>
  );
}

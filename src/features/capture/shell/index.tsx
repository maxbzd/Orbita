import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { recorderService } from '../../../state';
import type { CommandItem } from '../../../ui/shell/commandFilter';
import type { SphereGesture } from '../../../ui/shell/NavPill';
import { ConnectedDock, ConnectedMiniRecorder, ConnectedSphere, RecorderPresence } from './ConnectedRecorders';
import { ProcessingNotifier } from './ProcessingNotifier';
import { QuickThoughtSheet } from './QuickThoughtSheet';
import { RecoveryPrompt } from './RecoveryPrompt';
import { ARC_ACTIONS } from './arc';
import { useQuickActions } from './quickActions';
import { useSphereActions, useSphereMenu } from './SphereMenu';
import { t } from '../../../i18n';

export { ARC_ACTIONS } from './arc';
export { RecoveryPrompt } from './RecoveryPrompt';

export interface CaptureShell {
  /** The sphere and the global shortcut: start recording inside the gesture, then show the recording screen. */
  record(): void;
  sphere: ReactNode;
  miniRecorder: ReactNode;
  dock: ReactNode;
  sphereGesture: SphereGesture;
  /** «Текст», «Состояние», «Импорт ИИ-диалога», «Быстрая мысль» for the command palette. */
  commandActions: CommandItem[];
  /** Renders inside the shell: presence of the mini recorder, the arc, the sheets, the recovery offer. */
  overlay: ReactNode;
}

/**
 * Everything the app shell needs from the capture feature, in one hook: the live sphere, the mini recorder and
 * the dock that follow a running recording, the hold-arc of the sphere, and the sheets behind it.
 */
export function useCaptureShell(): CaptureShell {
  const navigate = useNavigate();
  const { gesture, element } = useSphereMenu();
  const { run } = useSphereActions();

  const record = useCallback(() => {
    // The microphone request happens here, inside the tap; the screen only shows what is already going on.
    void recorderService.start();
    navigate('/capture');
  }, [navigate]);

  const commandActions = useMemo<CommandItem[]>(
    () =>
      ARC_ACTIONS.map((action) => ({
        id: `capture-${action.id}`,
        title: action.label,
        icon: action.icon,
        group: t('Actions'),
        keywords: [action.hint, t('record'), t('add')],
        run: () => run(action.id),
      })),
    [run],
  );

  const sphere = useMemo(() => <ConnectedSphere />, []);
  const miniRecorder = useMemo(() => <ConnectedMiniRecorder />, []);
  const dock = useMemo(() => <ConnectedDock />, []);
  const overlay = (
    <>
      <RecorderPresence />
      {element}
      <LazyImportSheet />
      <QuickThoughtSheet />
      <RecoveryPrompt />
      <ProcessingNotifier />
    </>
  );

  return { record, sphere, miniRecorder, dock, sphereGesture: gesture, commandActions, overlay };
}

const ImportSheet = lazy(() => import('./ImportSheet').then((module) => ({ default: module.ImportSheet })));

/**
 * The AI-dialog import is loaded the first time it is asked for, not at launch: it brings the whole chat-export parser with it.
 * Once loaded it stays mounted, so that closing it can finish its exit animation.
 */
function LazyImportSheet() {
  const open = useQuickActions((state) => state.sheet === 'import');
  const [wanted, setWanted] = useState(false);
  if (open && !wanted) setWanted(true);
  return wanted ? (
    <Suspense fallback={null}>
      <ImportSheet />
    </Suspense>
  ) : null;
}

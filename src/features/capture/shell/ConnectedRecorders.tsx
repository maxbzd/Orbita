import { useNavigate } from 'react-router-dom';
import { recorderService, selectIsRecording, useRecorder } from '../../../state';
import { DockRecorder, MiniRecorder } from '../../../ui/audio';
import { OrbButton, useOrbLevel } from '../../../ui/orb';
import { useToast } from '../../../ui/primitives';
import { useMiniRecorder } from '../../../ui/shell/ShellContext';
import { t } from '../../../i18n';

/** Holds the mini recorder / dock open while a recording runs and the user is somewhere else in the shell. */
export function RecorderPresence() {
  const recording = useRecorder(selectIsRecording);
  useMiniRecorder(recording);
  return null;
}

/** What the three recorder widgets share: the numbers and the three handlers. */
function useRecorderControls() {
  const navigate = useNavigate();
  const toast = useToast();
  const phase = useRecorder((state) => state.phase);
  const seconds = useRecorder((state) => state.elapsedMs) / 1000;
  const paused = phase === 'paused';
  const level = useOrbLevel(recorderService.level, phase === 'recording');

  return {
    seconds,
    paused,
    level,
    open: () => navigate('/capture'),
    toggle: () => (paused ? recorderService.resume() : recorderService.pause()),
    done: () => {
      const id = recorderService.store.getState().captureId;
      void recorderService.done();
      toast.show({
        message: t('Recorded. Processing.'),
        ...(id && { actionLabel: t('Open', undefined, 'connected-recorders'), onAction: () => navigate(`/review/${id}`) }),
      });
    },
  };
}

/** `● 02:14 ▮▮▮▮ ⏸ ✓` above the phone pill. */
export function ConnectedMiniRecorder() {
  const { seconds, paused, level, open, toggle, done } = useRecorderControls();
  return <MiniRecorder seconds={seconds} paused={paused} level={level} onOpen={open} onTogglePause={toggle} onDone={done} />;
}

/** The 64 px recorder of tablets and desktops. */
export function ConnectedDock() {
  const { seconds, paused, level, open, toggle, done } = useRecorderControls();
  return <DockRecorder seconds={seconds} paused={paused} level={level} onOpen={open} onTogglePause={toggle} onDone={done} />;
}

/** The Canvas orb in the middle of the navigation pill: it listens while a recording runs. */
export function ConnectedSphere() {
  const phase = useRecorder((state) => state.phase);
  const recording = phase === 'recording' || phase === 'paused';
  const level = useOrbLevel(recorderService.level, phase === 'recording');
  return <OrbButton interactive={false} size={68} recording={recording} state={phase === 'paused' ? 'paused' : recording ? 'listening' : 'idle'} level={level} />;
}

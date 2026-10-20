import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { processing as appProcessing } from '../../../state';
import type { ProcessingService } from '../../../state';
import { useToast } from '../../../ui/primitives';
import { t, tn } from '../../../i18n';

const objects = (count: number): string => tn(count, '{n} object', '{n} objects');

/**
 * Tells the user how a background job ended when they are not looking at it: «Нашёл 3 объекта» with a way to the
 * review. On the review screen of that very capture, and on the recording screen, it stays quiet.
 */
export function ProcessingNotifier({ service = appProcessing }: { service?: Pick<ProcessingService, 'onSettled'> }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const path = useRef(pathname);
  useEffect(() => {
    path.current = pathname;
  }, [pathname]);

  useEffect(
    () =>
      service.onSettled(({ captureId, job }) => {
        if (path.current === `/review/${captureId}`) return;
        const open = () => navigate(`/review/${captureId}`);
        if (job.stage === 'done' && job.result) {
          const waiting = job.result.items.filter((item) => item.status === 'proposed').length;
          if (waiting > 0) {
            toast.show({ message: t('Found {objects}.', { objects: objects(waiting) }), actionLabel: t('Review', undefined, 'processing-notifier'), onAction: open, duration: 8000 });
          } else if (job.result.autoAccepted > 0) {
            toast.show({ message: t('Recorded. Accepted automatically: {autoAccepted}.', { autoAccepted: job.result.autoAccepted }) });
          } else {
            toast.show({ message: t('Recorded. No objects found in this recording.') });
          }
        } else if (job.stage === 'failed') {
          toast.show({ message: t('Could not process the recording. It is saved.'), tone: 'danger', actionLabel: t('Open', undefined, 'processing-notifier'), onAction: open, duration: 8000 });
        } else if (job.stage === 'waiting' && job.waiting === 'no-key') {
          toast.show({ message: t('The recording is saved and waiting to be processed: no AI key is set.'), actionLabel: t('What to do'), onAction: open, duration: 8000 });
        }
      }),
    [navigate, toast, service],
  );

  return null;
}

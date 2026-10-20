import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ImportError, importConversations, parseExport, parsePastedChat } from '../../../ai';
import type { ImportedConversation } from '../../../ai';
import { processing } from '../../../state';
import { Button, Caption, Field, SegmentedControl, Sheet, TextArea, useToast } from '../../../ui/primitives';
import { useQuickActions } from './quickActions';
import styles from './shell.module.css';
import { t, tn } from '../../../i18n';

type Mode = 'paste' | 'file';

const MODES = [
  { value: 'paste', get label() { return t('Paste text') } },
  { value: 'file', get label() { return t('File') } },
] as const;

const FILE_LIMIT_BYTES = 200 * 1024 * 1024;
const PREVIEW_LIMIT = 100;

const messages = (count: number): string => tn(count, '{n} message', '{n} messages');
const conversationsRu = (count: number): string => tn(count, '{n} conversation', '{n} conversations');

/**
 * «Импорт ИИ-диалога»: a conversation with ChatGPT or Claude becomes a capture, so that "разговоры с ИИ" stop being a
 * dump. Pasted text is one dialog; `conversations.json` from the service's export may hold hundreds, the user picks.
 */
export function ImportSheet() {
  const open = useQuickActions((state) => state.sheet === 'import');
  const close = useQuickActions((state) => state.close);
  const navigate = useNavigate();
  const toast = useToast();

  const [mode, setMode] = useState<Mode>('paste');
  const [pasted, setPasted] = useState('');
  const [title, setTitle] = useState('');
  const [parsed, setParsed] = useState<ImportedConversation[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode('paste');
    setPasted('');
    setTitle('');
    setParsed(null);
    setFileName('');
    setPicked(new Set());
    setError(null);
    setBusy(false);
  }, [open]);

  const readFile = async (file: File): Promise<void> => {
    setError(null);
    setParsed(null);
    if (file.size > FILE_LIMIT_BYTES) {
      setError(t('The file is too large to import on the device. Choose a smaller export or paste the conversation as text.'));
      return;
    }
    setBusy(true);
    try {
      const { conversations } = parseExport(await file.text());
      setFileName(file.name);
      setParsed(conversations);
      setPicked(new Set(conversations.slice(0, PREVIEW_LIMIT).map((_, index) => index)));
    } catch (failure) {
      setError(failure instanceof ImportError ? failure.message : t('Could not read the file. A conversations.json from a ChatGPT or Claude export is needed.'));
    } finally {
      setBusy(false);
    }
  };

  const finish = async (conversations: readonly ImportedConversation[]): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const { created, skipped } = await importConversations(conversations);
      if (created.length === 0) {
        const already = skipped.some((skip) => skip.reason === 'already-imported');
        setError(already ? t('This conversation has already been imported.') : t('The conversation has no text to import.'));
        return;
      }
      close();
      if (created.length === 1) {
        const id = created[0]!.id;
        // One pasted dialog is worth reading right away.
        processing.markSaving(id);
        void processing.enqueue(id);
        navigate(`/review/${id}`);
      } else {
        toast.show({ message: t('Imported: {conversationsRu}. They are waiting to be processed in the Stream.', { conversationsRu: conversationsRu(created.length) }) });
      }
    } catch {
      setError(t('Could not save the conversations on the device. Check the free space.'));
    } finally {
      setBusy(false);
    }
  };

  const submitPaste = (): void => {
    try {
      void finish([parsePastedChat(pasted, title.trim() ? { title: title.trim() } : {})]);
    } catch (failure) {
      setError(failure instanceof ImportError ? failure.message : t('Could not parse the text.'));
    }
  };

  const chosen = parsed ? parsed.filter((_, index) => picked.has(index)) : [];
  const shown = parsed ? parsed.slice(0, PREVIEW_LIMIT) : [];

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('Import an AI conversation')}
      placement="auto"
      snaps={[0.7, 0.92]}
      defaultSnapIndex={mode === 'file' && parsed ? 1 : 0}
      footer={
        mode === 'paste' ? (
          <Button variant="primary" fullWidth loading={busy} disabled={pasted.trim() === ''} onClick={submitPaste}>
            {t('Import and process')}
          </Button>
        ) : (
          <Button variant="primary" fullWidth loading={busy} disabled={chosen.length === 0} onClick={() => void finish(chosen)}>
            {chosen.length > 0 ? t('Import ({count})', { count: chosen.length }) : t('Import')}
          </Button>
        )
      }
    >
      <div className={styles.stack}>
        <SegmentedControl aria-label={t('Where the conversation is from')} options={MODES} value={mode} onChange={(value) => { setMode(value); setError(null); }} fullWidth />

        {mode === 'paste' ? (
          <>
            <TextArea
              data-autofocus=""
              label={t('Text of the conversation')}
              placeholder={t('Me: …\\nChatGPT: …')}
              hint={t('A text from a chat with the labels “Me:” and “ChatGPT:” works, or just your own thoughts.')}
              rows={7}
              value={pasted}
              onChange={(event) => { setPasted(event.target.value); setError(null); }}
              error={error ?? undefined}
            />
            <Field label={t('Title (optional)')} value={title} maxLength={80} onChange={(event) => setTitle(event.target.value)} />
          </>
        ) : (
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              className={styles.file}
              aria-label={t('The conversations.json file')}
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void readFile(file);
              }}
            />
            <Button variant="secondary" iconStart="import" fullWidth loading={busy && !parsed} onClick={() => fileInput.current?.click()}>
              {parsed ? t('Choose another file') : t('Choose conversations.json')}
            </Button>
            <p className={styles.fine}>
              {t('The file from “Export data” in ChatGPT or Claude. It is read on the device and sent nowhere.')}
            </p>
            {error ? (
              <p role="alert" className={styles.hint} style={{ color: 'var(--danger)' }}>
                {error}
              </p>
            ) : null}
            {parsed ? (
              <>
                <Caption>
                  {fileName}: {conversationsRu(parsed.length)}
                  {parsed.length > PREVIEW_LIMIT ? t(', first {PREVIEW_LIMIT} shown', { PREVIEW_LIMIT }) : ''}
                </Caption>
                <div className={styles.row}>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set(shown.map((_, index) => index)))}>
                    {t('Select all')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>
                    {t('Clear selection')}
                  </Button>
                </div>
                <ul className={styles.list}>
                  {shown.map((conversation, index) => (
                    <li key={`${conversation.externalId ?? 'c'}-${index}`}>
                      <label className={styles.pick}>
                        <input
                          type="checkbox"
                          checked={picked.has(index)}
                          onChange={(event) => {
                            const next = new Set(picked);
                            if (event.target.checked) next.add(index);
                            else next.delete(index);
                            setPicked(next);
                          }}
                        />
                        <span className={styles.pickText}>
                          <span className={styles.pickTitle}>{conversation.title}</span>
                          <Caption>{messages(conversation.messages.length)}</Caption>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </>
        )}
      </div>
    </Sheet>
  );
}

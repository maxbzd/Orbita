import { Link } from 'react-router-dom';
import { segmentAnswer } from '../../ai';
import type { AskAnswer, Citation } from '../../ai';
import { useEntity } from '../../db/hooks';
import { Caption, Icon, Mono, Thought } from '../../ui';
import { KIND_LABELS, citationPath } from './model';
import styles from './Ask.module.css';
import { t } from '../../i18n';

/** A citation as a mono chip that links to the record, object, person or pattern. */
export function CitationChip({ citation }: { citation: Pick<Citation, 'kind' | 'id' | 'label' | 'code'> }) {
  const entity = useEntity(citation.kind === 'item' ? citation.id : undefined);
  const item = entity?.table === 'items' ? entity.record : null;
  return (
    <Link to={citationPath(citation, item)} className={styles.ref} aria-label={`${KIND_LABELS[citation.kind]}: ${citation.label}`}>
      <Icon name={citation.kind === 'person' ? 'person' : citation.kind === 'pattern' ? 'pattern' : citation.kind === 'item' ? 'link' : 'text'} size={14} />
      <Mono size={12}>{citation.label}</Mono>
    </Link>
  );
}

/**
 * The finished answer: the text in the serif voice, the verified citations as links inside the sentences. The text is
 * cut into pieces and rendered as React text, so a model answer can never inject HTML.
 */
export function AnswerView({ answer }: { answer: AskAnswer }) {
  const segments = segmentAnswer(answer.text, answer.citations);
  const seen = answer.materials.sources;
  return (
    <>
      <Thought as="div" className={styles.answerText}>
        {segments.map((segment, index) =>
          segment.type === 'text' ? <span key={index}>{segment.text}</span> : <CitationChip key={index} citation={segment.citation} />,
        )}
      </Thought>
      {seen.length > 0 ? (
        <details className={styles.seen}>
          <summary>
            <Caption>{t('What the AI saw: {count}', { count: seen.length })}</Caption>
          </summary>
          <div className={styles.seenList}>
            {seen.map((source) => (
              <CitationChip key={source.code} citation={source} />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}

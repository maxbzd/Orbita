import { forwardRef, useCallback, useImperativeHandle, useRef } from 'react';
import type { ReactNode } from 'react';
import { Button } from '../primitives/Button';
import { cx } from '../primitives/cx';
import styles from './objects.module.css';
import { t } from '../../i18n';

export interface ObjectBaseProps {
  /**
   * Shows a "Сохранить картинкой" button under the object and calls this with the drawn `<svg>`. Pass it to
   * `saveAsImage(svg, 'name.png')` or to your own export. Nothing is exported by the component itself.
   */
  onSave?: (svg: SVGSVGElement) => void;
  /** Text of the button. */
  saveLabel?: string;
  /** Largest width in px; the object scales down with its container. */
  maxWidth?: number;
  className?: string;
}

interface ObjectFrameProps extends ObjectBaseProps {
  viewBox: string;
  /** What a screen reader says about the object: the real content, not the drawing. */
  label: string;
  svgClassName?: string;
  children: ReactNode;
}

/** The figure around every SVG object: an image role, the viewBox, an optional save button outside the drawing. */
export const ObjectFrame = forwardRef<SVGSVGElement, ObjectFrameProps>(function ObjectFrame(
  { viewBox, label, onSave, saveLabel = t('Save as an image'), maxWidth, className, svgClassName, children },
  ref,
) {
  const inner = useRef<SVGSVGElement>(null);
  useImperativeHandle(ref, () => inner.current as SVGSVGElement);
  const save = useCallback(() => {
    if (inner.current) onSave?.(inner.current);
  }, [onSave]);
  return (
    <figure className={cx(styles.figure, className)} style={maxWidth ? { maxWidth } : undefined}>
      <svg
        ref={inner}
        className={cx(styles.svg, svgClassName)}
        viewBox={viewBox}
        role="img"
        aria-label={label}
        data-export-root=""
        focusable="false"
      >
        {children}
      </svg>
      {onSave ? (
        <Button className={styles.save} variant="secondary" size="sm" onClick={save}>
          {saveLabel}
        </Button>
      ) : null}
    </figure>
  );
});

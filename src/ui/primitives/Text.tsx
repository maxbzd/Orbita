import { createElement, useEffect } from 'react';
import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { loadItalicFonts } from '../../styles/fonts';
import { cx } from './cx';
import styles from './Text.module.css';

/**
 * The text voices: serif for meaning (Display, Thought),
 * sans for the tool (Heading, Body, Caption), mono caps for process (Label, Mono).
 * Not more than two voices on a screen.
 */

type TextTag =
  | 'p'
  | 'span'
  | 'div'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'h5'
  | 'h6'
  | 'label'
  | 'blockquote'
  | 'strong'
  | 'em'
  | 'li'
  | 'time'
  | 'output';

interface TextProps extends HTMLAttributes<HTMLElement> {
  as?: TextTag;
  children?: ReactNode;
}

function text(tag: TextTag, classes: Array<string | false | undefined>, { className, ...rest }: HTMLAttributes<HTMLElement>, children: ReactNode) {
  return createElement(tag, { className: cx(...classes, className), ...rest }, children);
}

function useItalic(italic: boolean | undefined): void {
  useEffect(() => {
    if (italic) void loadItalicFonts();
  }, [italic]);
}

export interface DisplayProps extends TextProps {
  /** `xl` 44 px: the verdict, "Записано". `l` 32 px: a review title, a name, a mood word. */
  size?: 'xl' | 'l';
  /** Mood words are display italics. */
  italic?: boolean;
}

/** Cormorant Garamond, 500. Never below 28 px: thin serif on a gradient is unreadable. */
export function Display({ as, size = 'xl', italic, children, ...rest }: DisplayProps) {
  useItalic(italic);
  return text(as ?? (size === 'xl' ? 'h1' : 'h2'), [styles.display, styles[`display-${size}`], italic && styles.italic], rest, children);
}

export interface HeadingProps extends TextProps {
  /** `title` 22/600 for screens and sections; `headline` 17/600 for cards and rows. */
  variant?: 'title' | 'headline';
}

export function Heading({ as, variant = 'title', children, ...rest }: HeadingProps) {
  return text(as ?? (variant === 'title' ? 'h2' : 'h3'), [styles[variant]], rest, children);
}

export interface BodyProps extends TextProps {
  tone?: 'default' | 'muted';
}

/** Interface text, 16/1.5 (not smaller: iOS Safari zooms inputs below 16). */
export function Body({ as = 'p', tone = 'default', children, ...rest }: BodyProps) {
  return text(as, [styles.body, tone === 'muted' && styles.muted], rest, children);
}

export interface CaptionProps extends TextProps {
  /** `faint` uses ink-3: only on flat surfaces, never over an aura. */
  tone?: 'default' | 'faint';
}

/** Metadata, 13 px in ink-2. */
export function Caption({ as = 'span', tone = 'default', children, ...rest }: CaptionProps) {
  return text(as, [styles.caption, tone === 'faint' && styles.faint], rest, children);
}

export interface ThoughtProps extends TextProps {
  /** `md` 18/1.55 for a transcript or an answer; `sm` 16/1.5 compact. */
  size?: 'md' | 'sm';
  italic?: boolean;
}

/** Literata: what the user said and what the AI answered. */
export function Thought({ as = 'p', size = 'md', italic, children, ...rest }: ThoughtProps) {
  useItalic(italic);
  return text(as, [styles.thought, size === 'sm' && styles['thought-sm'], italic && styles.italic], rest, children);
}

export interface LabelProps extends TextProps {
  tone?: 'default' | 'strong';
}

/** Mono caps 11 px: section captions, record types. Colour never darker than ink-2. */
export function Label({ as = 'span', tone = 'default', children, ...rest }: LabelProps) {
  return text(as, [styles.label, tone === 'strong' && styles.strong], rest, children);
}

export interface MonoProps extends TextProps {
  /** Font size in px for numerals (15-72). Default 15. */
  size?: number;
}

/** JetBrains Mono numerals with tabular figures: timers, counters. */
export function Mono({ as = 'span', size, style, children, ...rest }: MonoProps) {
  const merged: CSSProperties | undefined = size ? { fontSize: size, ...style } : style;
  return text(as, [styles.mono], { ...rest, style: merged }, children);
}

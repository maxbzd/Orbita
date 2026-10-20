/**
 * Shareable objects: the insight star, the day ticket, the year passport, the
 * month poster, the type collection card and the story player. Objects are drawn as pure SVG so that they can be
 * exported to a PNG without libraries (`saveAsImage`). Everything is presentational: data in props, callbacks out.
 */
export { InsightStar } from './InsightStar';
export type { InsightStarProps } from './InsightStar';
export { Ticket } from './Ticket';
export type { TicketProps, TicketStat } from './Ticket';
export { Passport } from './Passport';
export type { PassportProps, PassportStat } from './Passport';
export { Poster } from './Poster';
export type { PosterProps, PosterStat } from './Poster';
export { CollectionCard, LONG_PRESS_MS } from './CollectionCard';
export type { CollectionCardProps } from './CollectionCard';
export { StoryViewer } from './StoryViewer';
export type { StoryExportInfo, StorySlide, StoryViewerProps } from './StoryViewer';
export { BACK_ZONE, SWIPE_CLOSE_MIN, SWIPE_MIN, TAP_MAX_MOVE, TAP_MAX_MS, classifyGesture, useStoryClock } from './storyLogic';
export type { GestureInput, StoryGesture } from './storyLogic';
export { downloadBlob, exportToBlob, findExportSvg, prepareSvg, renderSvgToCanvas, saveAsImage, svgDataUrl, svgSize } from './exportImage';
export type { ExportOptions, PreparedSvg } from './exportImage';
export { ObjectFrame } from './ObjectFrame';
export type { ObjectBaseProps } from './ObjectFrame';
export {
  GLYPH_RATIO,
  barcodeBars,
  buildMrz,
  daysInMonth,
  firstWeekday,
  fitFontSize,
  fitParagraph,
  monthDots,
  mrzCheckDigit,
  proportionalSweeps,
  starPath,
  starPoints,
  starRadius,
  textWidth,
  wrapLines,
} from './geometry';
export type { BarcodeBar, FittedParagraph, MonthDot, MrzInput, StarOptions } from './geometry';

/** Page geometry in CSS pixels (96 per inch). */
export interface PageFormat {
  name: string
  width: number
  height: number
  marginTop: number
  marginBottom: number
  marginLeft: number
  marginRight: number
}

const mm = (value: number): number => Math.round((value / 25.4) * 96)

export const A4: PageFormat = {
  name: 'A4',
  width: mm(210),
  height: mm(297),
  marginTop: mm(25),
  marginBottom: mm(25),
  marginLeft: mm(25),
  marginRight: mm(25)
}

/** Vertical space between two pages on screen. */
export const PAGE_GAP = 32

/**
 * Height of the band inside the bottom margin that holds the page number.
 * The pagination layer adds the footer's height to the bottom margin it is
 * given, so the margin passed to it is reduced by this band. The text area
 * then has exactly the format's margins. Must match the CSS height of
 * .rm-page-footer-content.
 */
export const FOOTER_BAND = 54

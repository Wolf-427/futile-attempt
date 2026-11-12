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

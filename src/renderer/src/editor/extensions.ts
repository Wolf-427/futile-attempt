import type { Extensions } from '@tiptap/core'
import { TextAlign } from '@tiptap/extension-text-align'
import { StarterKit } from '@tiptap/starter-kit'
import { PaginationPlus } from 'tiptap-pagination-plus'
import { Caret } from './caret'
import { Indent } from './indent'
import { A4, FOOTER_BAND, PAGE_GAP, type PageFormat } from './page'
import { PageBreak } from './pageBreak'
import { Search } from './search'

/**
 * The document schema. It is fixed on purpose: files store exactly these
 * nodes and marks, so anything added here is a file-format change.
 *
 * Blocks: paragraph (alignment, indent), heading 1-3 (alignment), blockquote,
 * bullet list, ordered list, page break. Inline: text, hard break.
 * Marks: bold, italic, underline, strike.
 */
export function schemaExtensions(): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      horizontalRule: false,
      link: false,
      // Clicking the empty part of a page must put the caret in the text, not
      // open a gap where typing would start a stray paragraph.
      gapcursor: false
    }),
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    Indent,
    PageBreak
  ]
}

export function editorExtensions(format: PageFormat = A4): Extensions {
  return [
    ...schemaExtensions(),
    Search,
    Caret,
    PaginationPlus.configure({
      pageHeight: format.height,
      pageWidth: format.width,
      pageGap: PAGE_GAP,
      pageGapBorderSize: 0,
      pageGapBorderColor: 'transparent',
      pageBreakBackground: 'var(--desk-bg)',
      marginTop: format.marginTop,
      marginBottom: format.marginBottom - FOOTER_BAND,
      marginLeft: format.marginLeft,
      marginRight: format.marginRight,
      contentMarginTop: 0,
      contentMarginBottom: 0,
      headerLeft: '',
      headerRight: '',
      footerLeft: '',
      footerRight: '{page}'
    })
  ]
}

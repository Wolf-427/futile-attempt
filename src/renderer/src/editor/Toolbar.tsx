import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'

interface ButtonProps {
  label: string
  title: string
  active?: boolean
  disabled?: boolean
  onClick(): void
  testId?: string
}

function Button(p: ButtonProps) {
  return (
    <button
      className={p.active ? 'tool active' : 'tool'}
      title={p.title}
      disabled={p.disabled}
      data-testid={p.testId}
      // Keep the selection in the document when a button is pressed.
      onMouseDown={(e) => e.preventDefault()}
      onClick={p.onClick}
    >
      {p.label}
    </button>
  )
}

export function Toolbar({ editor, onFind }: { editor: Editor; onFind(): void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 1 }) ? 'h1' : e.isActive('heading', { level: 2 }) ? 'h2' : e.isActive('heading', { level: 3 }) ? 'h3' : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      quote: e.isActive('blockquote'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      align: (['center', 'right', 'justify'] as const).find((a) => e.isActive({ textAlign: a })) ?? 'left',
      canUndo: e.can().undo(),
      canRedo: e.can().redo()
    })
  })
  const chain = () => editor.chain().focus()

  return (
    <div className="toolbar" data-testid="toolbar">
      <Button label="↶" title="Undo (⌘Z)" disabled={!s.canUndo} onClick={() => chain().undo().run()} />
      <Button label="↷" title="Redo (⇧⌘Z)" disabled={!s.canRedo} onClick={() => chain().redo().run()} />
      <span className="tool-sep" />
      <select
        className="tool-select"
        title="Paragraph style"
        data-testid="block-style"
        value={s.block}
        onChange={(e) => {
          const v = e.target.value
          if (v === 'p') chain().setParagraph().run()
          else chain().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 }).run()
        }}
      >
        <option value="p">Text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <span className="tool-sep" />
      <Button label="B" title="Bold (⌘B)" testId="bold" active={s.bold} onClick={() => chain().toggleBold().run()} />
      <Button label="I" title="Italic (⌘I)" active={s.italic} onClick={() => chain().toggleItalic().run()} />
      <Button label="U" title="Underline (⌘U)" active={s.underline} onClick={() => chain().toggleUnderline().run()} />
      <Button label="S" title="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()} />
      <span className="tool-sep" />
      <Button label="⇤" title="Align left" active={s.align === 'left'} onClick={() => chain().setTextAlign('left').run()} />
      <Button label="↔" title="Centre" active={s.align === 'center'} onClick={() => chain().setTextAlign('center').run()} />
      <Button label="⇥" title="Align right" active={s.align === 'right'} onClick={() => chain().setTextAlign('right').run()} />
      <Button label="≡" title="Justify" active={s.align === 'justify'} onClick={() => chain().setTextAlign('justify').run()} />
      <span className="tool-sep" />
      <Button label="•" title="Bullet list" active={s.bullet} onClick={() => chain().toggleBulletList().run()} />
      <Button label="1." title="Numbered list" active={s.ordered} onClick={() => chain().toggleOrderedList().run()} />
      <Button label="❝" title="Quote" active={s.quote} onClick={() => chain().toggleBlockquote().run()} />
      <Button label="→" title="Indent (Tab)" onClick={() => chain().indent().run()} />
      <Button label="←" title="Outdent (⇧Tab)" onClick={() => chain().outdent().run()} />
      <span className="tool-sep" />
      <Button label="⤓ Page break" title="Start a new page (⌘↵)" testId="page-break" onClick={() => chain().insertPageBreak().run()} />
      <span className="tool-space" />
      <Button label="Find" title="Find and replace (⌘F)" testId="find" onClick={onFind} />
    </div>
  )
}

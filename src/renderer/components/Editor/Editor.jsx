import React, { useEffect, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import Underline from '@tiptap/extension-underline'
import Highlight from '@tiptap/extension-highlight'
import CharacterCount from '@tiptap/extension-character-count'
import Typography from '@tiptap/extension-typography'
import { useStore } from '../../store'
import styles from './Editor.module.css'

export default function Editor({ project }) {
  const { docPath, setGit } = useStore()
  const saveTimer = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({ placeholder: 'Begin writing…' }),
      Underline,
      Highlight,
      CharacterCount,
      Typography,
    ],
    content: '',
    editorProps: { attributes: { class: styles.prose, spellcheck: 'true' } },
    onUpdate: ({ editor: e }) => {
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => save(e.getHTML()), 1400)
      setGit({ dirty: true })
    },
  })

  useEffect(() => {
    if (!editor || !docPath) return
    let cancelled = false
    window.api.fs.read(docPath).then(raw => {
      if (!cancelled) editor.commands.setContent(mdToHtml(raw), false)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [docPath, editor])

  async function save(html) {
    if (!docPath) return
    try { await window.api.fs.write(docPath, htmlToMd(html)) } catch {}
  }

  if (!docPath) return (
    <div className={styles.empty}>Select a document from the sidebar</div>
  )

  const words = editor?.storage.characterCount?.words() ?? 0
  const chars = editor?.storage.characterCount?.characters() ?? 0

  return (
    <div className={styles.root}>
      <Toolbar editor={editor} />
      <div className={styles.scroll}>
        <div className={styles.page}>
          <EditorContent editor={editor} />
        </div>
      </div>
      <div className={styles.status}>
        <span>{words} words</span>
        <span>{chars} characters</span>
      </div>
    </div>
  )
}

function Toolbar({ editor }) {
  if (!editor) return null

  const btn = (label, action, active, title) => (
    <button
      key={label}
      title={title || label}
      onMouseDown={e => { e.preventDefault(); action() }}
      className={`${styles.tool} ${active ? styles.toolActive : ''}`}
    >
      {label}
    </button>
  )
  const div = <div key="div" className={styles.div} />

  return (
    <div className={styles.toolbar}>
      {btn('H1', () => editor.chain().focus().toggleHeading({ level: 1 }).run(), editor.isActive('heading', { level: 1 }))}
      {btn('H2', () => editor.chain().focus().toggleHeading({ level: 2 }).run(), editor.isActive('heading', { level: 2 }))}
      {btn('H3', () => editor.chain().focus().toggleHeading({ level: 3 }).run(), editor.isActive('heading', { level: 3 }))}
      {div}
      {btn('B',  () => editor.chain().focus().toggleBold().run(),      editor.isActive('bold'),      'Bold ⌘B')}
      {btn('I',  () => editor.chain().focus().toggleItalic().run(),    editor.isActive('italic'),    'Italic ⌘I')}
      {btn('U',  () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), 'Underline ⌘U')}
      {btn('~',  () => editor.chain().focus().toggleStrike().run(),    editor.isActive('strike'),    'Strikethrough')}
      {div}
      {btn('❝', () => editor.chain().focus().toggleBlockquote().run(),  editor.isActive('blockquote'), 'Blockquote')}
      {btn('•', () => editor.chain().focus().toggleBulletList().run(),  editor.isActive('bulletList'), 'Bullet list')}
      {btn('1.', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), 'Numbered list')}
      {div}
      {btn('↩', () => editor.chain().focus().undo().run(), false, 'Undo ⌘Z')}
      {btn('↪', () => editor.chain().focus().redo().run(), false, 'Redo ⌘⇧Z')}
    </div>
  )
}

function mdToHtml(md) {
  return md
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,   '<em>$1</em>')
    .replace(/^> (.+)$/gm,   '<blockquote><p>$1</p></blockquote>')
    .split('\n\n').map(b => b.startsWith('<') ? b : `<p>${b || '<br>'}</p>`).join('')
    || '<p></p>'
}

function htmlToMd(html) {
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
    .trim() + '\n'
}

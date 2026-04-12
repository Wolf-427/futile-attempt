import React, { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import CharacterCount from '@tiptap/extension-character-count';
import Typography from '@tiptap/extension-typography';
import { useStore } from '../../store';
import s from './EditorView.module.css';

export default function EditorView({ project }) {
  const { activeDocPath, setGitStatus } = useStore();
  const saveTimer = useRef(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels:[1,2,3] } }),
      Placeholder.configure({ placeholder:'Begin writing…' }),
      Underline, Highlight, CharacterCount, Typography,
    ],
    content: '',
    editorProps: { attributes: { class: s.prose, spellcheck:'true' } },
    onUpdate: ({ editor: e }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => doSave(e.getHTML()), 1200);
    },
  });

  useEffect(() => {
    if (!activeDocPath || !editor) return;
    let cancelled = false;
    window.api.fs.readFile(activeDocPath).then((raw) => {
      if (cancelled) return;
      editor.commands.setContent(mdToHtml(raw), false);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [activeDocPath, editor]);

  async function doSave(html) {
    if (!activeDocPath) return;
    try { await window.api.fs.writeFile(activeDocPath, htmlToMd(html)); setGitStatus({ dirty:true }); } catch {}
  }

  if (!activeDocPath) return (
    <div className={s.empty}><p>Select a document from the sidebar to start writing.</p></div>
  );

  const words = editor?.storage.characterCount?.words() ?? 0;
  const chars = editor?.storage.characterCount?.characters() ?? 0;

  return (
    <div className={s.root}>
      <Toolbar editor={editor} />
      <div className={s.scroll}><div className={s.page}><EditorContent editor={editor} /></div></div>
      <div className={s.status}><span>{words} words</span><span>{chars} chars</span></div>
    </div>
  );
}

function Toolbar({ editor }) {
  if (!editor) return null;
  const btn = (label, action, active, title) => (
    <button key={label} className={`${s.toolBtn} ${active ? s.toolActive : ''}`} onClick={action} title={title||label}>{label}</button>
  );
  return (
    <div className={s.toolbar}>
      {btn('H1', () => editor.chain().focus().toggleHeading({level:1}).run(), editor.isActive('heading',{level:1}))}
      {btn('H2', () => editor.chain().focus().toggleHeading({level:2}).run(), editor.isActive('heading',{level:2}))}
      {btn('H3', () => editor.chain().focus().toggleHeading({level:3}).run(), editor.isActive('heading',{level:3}))}
      <div className={s.div} />
      {btn('B',  () => editor.chain().focus().toggleBold().run(),      editor.isActive('bold'),      'Bold ⌘B')}
      {btn('I',  () => editor.chain().focus().toggleItalic().run(),    editor.isActive('italic'),    'Italic ⌘I')}
      {btn('U',  () => editor.chain().focus().toggleUnderline().run(), editor.isActive('underline'), 'Underline ⌘U')}
      {btn('S',  () => editor.chain().focus().toggleStrike().run(),    editor.isActive('strike'),    'Strikethrough')}
      <div className={s.div} />
      {btn('❝', () => editor.chain().focus().toggleBlockquote().run(), editor.isActive('blockquote'), 'Blockquote')}
      {btn('•', () => editor.chain().focus().toggleBulletList().run(), editor.isActive('bulletList'), 'Bullet list')}
      {btn('1.', () => editor.chain().focus().toggleOrderedList().run(), editor.isActive('orderedList'), 'Numbered list')}
      <div className={s.div} />
      {btn('↩', () => editor.chain().focus().undo().run(), false, 'Undo ⌘Z')}
      {btn('↪', () => editor.chain().focus().redo().run(), false, 'Redo ⌘⇧Z')}
    </div>
  );
}

function mdToHtml(md) {
  return md
    .replace(/^### (.+)$/gm,'<h3>$1</h3>').replace(/^## (.+)$/gm,'<h2>$1</h2>').replace(/^# (.+)$/gm,'<h1>$1</h1>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>').replace(/\*(.+?)\*/g,'<em>$1</em>')
    .replace(/^> (.+)$/gm,'<blockquote><p>$1</p></blockquote>')
    .replace(/\n\n/g,'</p><p>') || '<p></p>';
}

function htmlToMd(html) {
  return html
    .replace(/<h1>(.*?)<\/h1>/gi,'# $1\n').replace(/<h2>(.*?)<\/h2>/gi,'## $1\n').replace(/<h3>(.*?)<\/h3>/gi,'### $1\n')
    .replace(/<strong>(.*?)<\/strong>/gi,'**$1**').replace(/<em>(.*?)<\/em>/gi,'*$1*')
    .replace(/<blockquote><p>(.*?)<\/p><\/blockquote>/gi,'> $1\n')
    .replace(/<li>(.*?)<\/li>/gi,'- $1\n').replace(/<ul>|<\/ul>|<ol>|<\/ol>/gi,'')
    .replace(/<p>(.*?)<\/p>/gi,'$1\n\n').replace(/<br\s*\/?>/gi,'\n').replace(/<[^>]+>/g,'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')
    .trim() + '\n';
}

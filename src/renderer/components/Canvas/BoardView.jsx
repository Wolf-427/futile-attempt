import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useStore } from '../../store';
import { saveBoard, createBoard } from '../../services/project';
import { v4 as uuid } from 'uuid';
import s from './BoardView.module.css';

const MIN_ZOOM = 0.15, MAX_ZOOM = 3;

export default function BoardView({ project }) {
  const { activeBoardPath, setActiveBoard, boardHistory, boardBack } = useStore();
  const [board, setBoard] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x:80, y:80 });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x:0, y:0 });
  const dragging = useRef(null);
  const dragOff = useRef({ x:0, y:0 });
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!project?.folderPath || !activeBoardPath) return;
    window.api.fs.readFile(`${project.folderPath}/boards/${activeBoardPath}`)
      .then((r) => setBoard(JSON.parse(r)))
      .catch(() => setBoard({ name:'Board', nodes:[] }));
  }, [project?.folderPath, activeBoardPath]);

  const persist = useCallback(async (b) => {
    await saveBoard(project.folderPath, activeBoardPath, b);
    useStore.getState().setGitStatus({ dirty:true });
  }, [project?.folderPath, activeBoardPath]);

  function setNodes(nodes) { const b = { ...board, nodes }; setBoard(b); persist(b); }

  function onMouseDown(e) {
    if (e.button===1 || (e.button===0 && e.altKey)) { isPanning.current=true; lastMouse.current={x:e.clientX,y:e.clientY}; e.preventDefault(); }
  }
  function onMouseMove(e) {
    if (isPanning.current) { setPan((p) => ({ x:p.x+(e.clientX-lastMouse.current.x), y:p.y+(e.clientY-lastMouse.current.y) })); lastMouse.current={x:e.clientX,y:e.clientY}; }
    if (dragging.current && board) {
      const r = canvasRef.current.getBoundingClientRect();
      const x = (e.clientX-r.left-pan.x)/zoom - dragOff.current.x;
      const y = (e.clientY-r.top-pan.y)/zoom - dragOff.current.y;
      setBoard((b) => ({ ...b, nodes: b.nodes.map((n) => n.id===dragging.current ? {...n,x:Math.round(x),y:Math.round(y)} : n) }));
    }
  }
  function onMouseUp() {
    isPanning.current=false;
    if (dragging.current && board) persist(board);
    dragging.current=null;
  }
  function onWheel(e) { e.preventDefault(); setZoom((z) => Math.min(MAX_ZOOM,Math.max(MIN_ZOOM,z-e.deltaY*0.001*z))); }

  async function onDrop(e) {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (!file?.type.startsWith('image/')) return;
    const r = canvasRef.current.getBoundingClientRect();
    const x = Math.round((e.clientX-r.left-pan.x)/zoom);
    const y = Math.round((e.clientY-r.top-pan.y)/zoom);
    const dest = `${project.folderPath}/references/${uuid()}-${file.name}`;
    await window.api.fs.copyFile(file.path, dest);
    setNodes([...board.nodes, { id:uuid(), type:'image', x, y, width:240, srcPath:dest, caption:'' }]);
  }

  function addNote(color) {
    const x = Math.round((-pan.x+400)/zoom), y = Math.round((-pan.y+300)/zoom);
    setNodes([...board.nodes, { id:uuid(), type:'note', color, x:x-100, y:y-80, width:200, text:'' }]);
  }

  async function addSubBoard() {
    const b = await createBoard(project.folderPath, `Board ${(board?.nodes||[]).filter(n=>n.type==='subboard').length+1}`);
    const x = Math.round((-pan.x+400)/zoom), y = Math.round((-pan.y+300)/zoom);
    setNodes([...board.nodes, { id:uuid(), type:'subboard', x:x-80, y:y-70, boardFileName:b.fileName, boardName:b.name, coverImage:null }]);
  }

  function startDrag(e, id) {
    if (e.button!==0) return; e.stopPropagation();
    const node = board.nodes.find((n)=>n.id===id); if (!node) return;
    const r = canvasRef.current.getBoundingClientRect();
    dragging.current=id;
    dragOff.current={ x:(e.clientX-r.left-pan.x)/zoom-node.x, y:(e.clientY-r.top-pan.y)/zoom-node.y };
  }

  function updateNode(id, patch) { setNodes(board.nodes.map((n)=>n.id===id?{...n,...patch}:n)); }
  function deleteNode(id) { setNodes(board.nodes.filter((n)=>n.id!==id)); }

  if (!board) return <div className={s.loading}>Loading…</div>;

  return (
    <div className={s.root}>
      <div className={s.toolbar}>
        {boardHistory.length>0 && <button className={s.back} onClick={boardBack}>← Back</button>}
        <span className={s.bname}>{board.name}</span>
        <div className={s.sep} />
        {['yellow','blue','green','purple'].map((c)=>(
          <button key={c} className={s.colorDot} style={{ background:`var(--note-${c}-bg)`, borderColor:`var(--note-${c}-border)` }} onClick={()=>addNote(c)} title={`Add ${c} note`}/>
        ))}
        <button className={s.tbtn} onClick={addSubBoard}>⊞ Sub-board</button>
        <div className={s.sep} />
        <span className={s.zoom}>{Math.round(zoom*100)}%</span>
        <button className={s.tbtn} onClick={()=>setZoom((z)=>Math.max(MIN_ZOOM,z-0.1))}>−</button>
        <button className={s.tbtn} onClick={()=>{setZoom(1);setPan({x:80,y:80});}}>⌂</button>
        <button className={s.tbtn} onClick={()=>setZoom((z)=>Math.min(MAX_ZOOM,z+0.1))}>+</button>
      </div>
      <div ref={canvasRef} className={s.canvas} onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel} onDrop={onDrop} onDragOver={(e)=>e.preventDefault()}>
        <div className={s.world} style={{ transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}>
          {board.nodes.map((node)=>{
            if (node.type==='note')     return <NotePin     key={node.id} node={node} onDragStart={(e)=>startDrag(e,node.id)} onChange={(p)=>updateNode(node.id,p)} onDelete={()=>deleteNode(node.id)} />;
            if (node.type==='image')    return <ImagePin    key={node.id} node={node} onDragStart={(e)=>startDrag(e,node.id)} onDelete={()=>deleteNode(node.id)} />;
            if (node.type==='subboard') return <SubBoardPin key={node.id} node={node} onDragStart={(e)=>startDrag(e,node.id)} onOpen={()=>setActiveBoard(node.boardFileName)} onChange={(p)=>updateNode(node.id,p)} onDelete={()=>deleteNode(node.id)} projectPath={project.folderPath} />;
            return null;
          })}
        </div>
      </div>
      <div className={s.hint}>Alt+drag or middle-click to pan · Scroll to zoom · Drop images onto canvas</div>
    </div>
  );
}

function NotePin({ node, onDragStart, onChange, onDelete }) {
  return (
    <div className={`${s.pin} ${s['note_'+node.color]}`} style={{left:node.x,top:node.y,width:node.width}} onMouseDown={onDragStart}>
      <div className={s.pinBar}><span className={s.pinLabel}>Note</span><button className={s.del} onMouseDown={(e)=>e.stopPropagation()} onClick={onDelete}>×</button></div>
      <textarea className={s.noteText} value={node.text} placeholder="Type a note…" onMouseDown={(e)=>e.stopPropagation()} onChange={(e)=>onChange({text:e.target.value})} />
    </div>
  );
}

function ImagePin({ node, onDragStart, onDelete }) {
  const [src,setSrc] = useState(null);
  useEffect(()=>{ window.api.fs.readFileBinary(node.srcPath).then((b)=>setSrc(`data:image/jpeg;base64,${b}`)).catch(()=>{}); },[node.srcPath]);
  return (
    <div className={`${s.pin} ${s.imgPin}`} style={{left:node.x,top:node.y,width:node.width}} onMouseDown={onDragStart}>
      <div className={s.pinBar}><span className={s.pinLabel}>Image</span><button className={s.del} onMouseDown={(e)=>e.stopPropagation()} onClick={onDelete}>×</button></div>
      {src ? <img src={src} alt="" className={s.img} draggable={false}/> : <div className={s.imgPh}>Loading…</div>}
    </div>
  );
}

function SubBoardPin({ node, onDragStart, onOpen, onChange, onDelete, projectPath }) {
  const [renaming,setRenaming] = useState(false);
  const [val,setVal] = useState(node.boardName);
  const [cover,setCover] = useState(null);
  useEffect(()=>{ if(!node.coverImage)return; window.api.fs.readFileBinary(node.coverImage).then((b)=>setCover(`data:image/jpeg;base64,${b}`)).catch(()=>{}); },[node.coverImage]);

  async function setCoverImg() {
    const fp = await window.api.dialog.openFile([{name:'Images',extensions:['jpg','jpeg','png','webp','gif']}]);
    if (!fp) return;
    const dest = `${projectPath}/references/cover-${uuid()}-${fp.split('/').pop()}`;
    await window.api.fs.copyFile(fp, dest);
    onChange({ coverImage:dest });
  }

  function finishRename() { if(val.trim()) onChange({boardName:val.trim()}); setRenaming(false); }

  return (
    <div className={s.sbPin} style={{left:node.x,top:node.y}} onMouseDown={onDragStart} onDoubleClick={(e)=>{e.stopPropagation();onOpen();}}>
      <div className={s.sbCover}>
        {cover ? <img src={cover} alt="" className={s.sbCoverImg} draggable={false}/> : <div className={s.sbCoverPh}>⊞</div>}
      </div>
      <div className={s.sbFooter}>
        {renaming
          ? <input autoFocus className={s.sbRename} value={val} onChange={(e)=>setVal(e.target.value)} onBlur={finishRename} onKeyDown={(e)=>{if(e.key==='Enter')finishRename();if(e.key==='Escape')setRenaming(false);}} onMouseDown={(e)=>e.stopPropagation()}/>
          : <span className={s.sbName}>{node.boardName}</span>
        }
      </div>
      <div className={s.sbActions} onMouseDown={(e)=>e.stopPropagation()}>
        <button className={s.sbAct} onClick={()=>setRenaming(true)} title="Rename">✎</button>
        <button className={s.sbAct} onClick={setCoverImg} title="Set cover">⊡</button>
        <button className={s.sbAct} style={{color:'var(--text-danger)'}} onClick={onDelete} title="Delete">×</button>
      </div>
      <div className={s.sbHint}>Double-click to open</div>
    </div>
  );
}

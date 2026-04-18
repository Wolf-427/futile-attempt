/**
 * LayoutEngine
 * Computes page breaks based on actual rendered coordinates.
 */
export class LayoutEngine {
  constructor(config) {
    this.config = config;
  }

  compute(view) {
    const { doc } = view.state;
    const breaks = [];
    const editorRect = view.dom.getBoundingClientRect();
    const editorTop = editorRect.top;

    const EPSILON = 0.2; 
    let pageIndex = 0;
    let accumulatedOffset = 0;

    doc.forEach((node, offset) => {
      if (!node.isBlock) return;

      const dom = view.nodeDOM(offset);
      if (!dom || !(dom instanceof HTMLElement)) return;

      const rect = dom.getBoundingClientRect();
      let nodeTop = rect.top - editorTop;
      let nodeBottom = rect.bottom - editorTop;
      const nodeEnd = offset + node.nodeSize;

      while (true) {
        const currentBoundary = this.config.margin + (this.config.contentHeight * (pageIndex + 1));
        
        let shouldBreakBefore = false;
        if (node.type.name === 'heading' && nodeBottom < (currentBoundary + EPSILON)) {
          const nextNode = doc.nodeAt(offset + node.nodeSize);
          if (nextNode && nextNode.isBlock) {
            const nextDom = view.nodeDOM(offset + node.nodeSize);
            if (nextDom && nextDom instanceof HTMLElement) {
              const nextRect = nextDom.getBoundingClientRect();
              if ((nextRect.bottom - editorTop) > (currentBoundary + EPSILON)) shouldBreakBefore = true;
            }
          }
        }

        const isManualBreak = node.type.name === 'horizontalRule';
        const isOverflowing = (nodeBottom > currentBoundary + EPSILON) || shouldBreakBefore;
        let splitPos = offset;
        let proposedSplitPos = offset;
        let proposedSplitYBottom = nodeTop;

        if (isOverflowing || isManualBreak) {
          if (!isManualBreak && !shouldBreakBefore && node.isTextblock) {
            const lineStarts = this.getLineStarts(view, offset, nodeEnd);
            
            // Find how many lines fully fit on the current page
            let linesFitting = 0;
            while (linesFitting < lineStarts.length) {
              const lineBottom = view.coordsAtPos(lineStarts[linesFitting]).bottom - editorTop;
              if (lineBottom > currentBoundary + EPSILON) break;
              linesFitting++;
            }

            const totalLines = lineStarts.length;

            // Apply Widow/Orphan Rules
            if (linesFitting <= 1 && totalLines > 1) {
              // Orphan: Only 1 line fits at the bottom. Move the whole block.
              shouldBreakBefore = true;
            } else if (linesFitting === totalLines - 1 && totalLines > 1) {
              // Widow: Only 1 line is left for the next page.
              // Move the break back one line so at least 2 lines go to the next page.
              proposedSplitPos = lineStarts[linesFitting - 1];
              proposedSplitYBottom = view.coordsAtPos(proposedSplitPos - 1).bottom - editorTop;
            } else if (linesFitting > 0 && linesFitting < totalLines) {
              // Standard split: Break at the first line that doesn't fit
              proposedSplitPos = lineStarts[linesFitting];
              proposedSplitYBottom = view.coordsAtPos(proposedSplitPos - 1).bottom - editorTop;
            } else if (linesFitting === 0) {
              // Block is entirely on the next page
              shouldBreakBefore = true;
            }
          }

          // If the entire node moves, we split at the current boundary.
          // Otherwise, we split at the bottom of the last fitting line.
          const splitY = shouldBreakBefore ? currentBoundary : proposedSplitYBottom;
          splitPos = shouldBreakBefore ? offset : proposedSplitPos;

          // nextPageTextStart is the absolute Y coordinate of the first line on the next page.
          // Formula: (Total physical height of previous pages) + Gap + Margin.
          const nextPageTextStart = ((pageIndex + 1) * this.config.pageHeight) + ((pageIndex + 1) * this.config.pageGap) + this.config.margin;
          const totalOffsetNeeded = nextPageTextStart - splitY;
          const spacerHeight = Math.max(0, totalOffsetNeeded - accumulatedOffset);

          // Floating point drift happens here. We round the spacer to a 
          // fixed precision to ensure cumulative math stays predictable.
          const preciseSpacer = Math.round(spacerHeight * 100) / 100;

          breaks.push({ 
            pos: splitPos, 
            height: preciseSpacer
          });
          
          accumulatedOffset += preciseSpacer;
          
          pageIndex++;
          
          if (isManualBreak || shouldBreakBefore) break;
          
          // Update nodeTop for the remainder of the block so that subsequent 
          // loops measure from the start of the new page.
          nodeTop = nextPageTextStart;

          const nextBoundary = this.config.margin + (this.config.contentHeight * (pageIndex + 1));
          if (nodeBottom <= nextBoundary + EPSILON) break;
        } else {
          break;
        }
      }
    });

    return { breaks, pageCount: pageIndex + 1 };
  }

  /**
   * Identifies the document position where each visual line begins within a block.
   */
  getLineStarts(view, start, end) {
    const starts = [start];
    let lastTop = view.coordsAtPos(start).top;
    
    // Iterate through characters to find where the vertical 'top' coordinate shifts.
    // This indicates a browser-level line wrap.
    for (let pos = start + 1; pos < end; pos++) {
      try {
        const top = view.coordsAtPos(pos).top;
        if (Math.abs(top - lastTop) > 2) {
          starts.push(pos);
          lastTop = top;
        }
      } catch (e) { /* ignore invalid pos */ }
    }
    return starts;
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }
}
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
    
    // Get the absolute top of the editor content to use as a stable zero-point.
    // This ensures coordinates are consistent even if the window is scrolled.
    const editorRect = view.dom.getBoundingClientRect();
    const editorTop = editorRect.top;

    const EPSILON = 1; 
    let pageIndex = 0;
    let accumulatedOffset = 0;

    doc.forEach((node, offset) => {
      if (!node.isBlock) return;

      const dom = view.nodeDOM(offset);
      if (!dom || !(dom instanceof HTMLElement)) return;

      const rect = dom.getBoundingClientRect();
      let nodeTop = Math.floor(rect.top - editorTop);
      let nodeBottom = Math.floor(rect.bottom - editorTop);

      // We use a while loop to handle nodes that are longer than a single page
      while (true) {
        // The boundary is the absolute point where Page N's content ends.
        // Page 1 ends at (Margin + ContentHeight).
        const currentBoundary = Math.floor(this.config.margin + (this.config.contentHeight * (pageIndex + 1)));
        
        let shouldBreakBefore = false;
        if (node.type.name === 'heading' && nodeBottom < (currentBoundary + EPSILON)) {
          const nextNode = doc.nodeAt(offset + node.nodeSize);
          if (nextNode && nextNode.isBlock) {
            const nextDom = view.nodeDOM(offset + node.nodeSize);
            if (nextDom && nextDom instanceof HTMLElement) {
              const nextRect = nextDom.getBoundingClientRect();
              if (Math.floor(nextRect.bottom - editorTop) > (currentBoundary + EPSILON)) shouldBreakBefore = true;
            }
          }
        }

        const isManualBreak = node.type.name === 'horizontalRule';
        const isOverflowing = (nodeBottom > currentBoundary + EPSILON) || shouldBreakBefore;

        if (isOverflowing || isManualBreak) {
          let splitPos = offset;
          let splitY = nodeTop;

          if (!isManualBreak && !shouldBreakBefore && node.isTextblock) {
            const targetY = editorTop + currentBoundary;
            const firstLineCoords = view.coordsAtPos(offset);
            
            // Use the absolute editorTop to normalize first line check
            if (Math.floor(firstLineCoords.bottom - editorTop) < (currentBoundary - 2)) {
              splitPos = this.findSplitPoint(view, offset, offset + node.nodeSize, targetY);
              const splitCoords = view.coordsAtPos(splitPos);
              splitY = Math.floor(splitCoords.bottom - editorTop);
            }
          }

          // nextPageTextStart is the absolute Y coordinate of the first line on the next page.
          // Formula: (Total physical height of previous pages) + Gap + Margin.
          const nextPageTextStart = ((pageIndex + 1) * this.config.pageHeight) + ((pageIndex + 1) * this.config.pageGap) + this.config.margin;
          const totalOffsetNeeded = nextPageTextStart - splitY;
          const spacerHeight = Math.max(0, totalOffsetNeeded - accumulatedOffset);

          breaks.push({ 
            pos: splitPos, 
            height: spacerHeight
          });

          accumulatedOffset += spacerHeight;
          
          pageIndex++;
          
          // If we split a paragraph, we need to check if the REMAINDER of it still overflows 
          // the next page boundary. If it's a manual break, we stop processing this node.
          if (isManualBreak || shouldBreakBefore) break;
          
          // If the original bottom of the node still exceeds the NEXT boundary, loop again
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
   * Binary search for the exact character position where a paragraph overflows the page.
   */
  findSplitPoint(view, start, end, targetY) {
    let low = start;
    let high = end;
    let best = start;

    // We use binary search to find the last position that still fits on the page
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      try {
        const coords = view.coordsAtPos(mid);
        if (coords.bottom <= targetY) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      } catch (e) {
        high = mid - 1;
      }
    }

    // If we couldn't find a clean split, split at the start of the block
    return best;
  }

  updateConfig(config) {
    this.config = { ...this.config, ...config };
  }
}
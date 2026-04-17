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

    let pageIndex = 0;
    
    // In a 'flat' document (no spacers), the first page content 
    // ends exactly at config.contentHeight.
    let currentBoundary = this.config.contentHeight;

    doc.forEach((node, offset) => {
      if (!node.isBlock) return;

      // We measure the bottom of the block
      const endCoords = view.coordsAtPos(offset + node.nodeSize - 1);
      
      // Normalize the coordinate relative to the editor's top
      const nodeBottom = endCoords.bottom - editorTop;

      const isManualBreak = node.type.name === 'horizontalRule';
      const isOverflowing = nodeBottom > currentBoundary;

      if (isOverflowing || isManualBreak) {
        let splitPos = offset;

        // Sophisticated Line-Level Splitting
        if (!isManualBreak && node.isTextblock && node.type.name === 'paragraph') {
          // Find the last character that fits within the current page boundary
          splitPos = this.findSplitPoint(view, offset, offset + node.nodeSize, editorTop + currentBoundary);
        }

        breaks.push({
          pos: splitPos,
          height: this.config.pageGap + (this.config.margin * 2),
        });

        pageIndex++;
        // The next page boundary is exactly one contentHeight further down in the flat doc.
        currentBoundary += this.config.contentHeight;
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
// LWH Warehouse Toolkit — Doc Scanner auto edge detection
//
// NOT the barcode/QR reader — that's still js/scanner.js untouched. This is
// a separate engine (exposed as window.DocAutoDetect) that powers Doc
// Scanner's automatic corner detection and perspective straightening. Ported
// from the standalone LWH Driver Scan PWA, same detection pipeline.
//
// Uses OpenCV.js (loaded in index.html) — this file only calls it, it
// doesn't load it.

window.DocAutoDetect = (() => {
  let cvReady = false;
  const readyCallbacks = [];

  function markReady() {
    if (cvReady) return;
    cvReady = true;
    readyCallbacks.forEach((cb) => cb());
    readyCallbacks.length = 0;
  }

  window.addEventListener("opencv-ready", markReady);

  // Fallback in case the event fired before this listener attached.
  if (!cvReady) {
    let attempts = 0;
    const poll = setInterval(() => {
      attempts++;
      if (window.cv && cv.Mat) { clearInterval(poll); markReady(); }
      else if (attempts > 200) { clearInterval(poll); }
    }, 100);
  }

  function whenReady(cb) {
    if (cvReady && window.cv && cv.Mat) cb();
    else readyCallbacks.push(cb);
  }

  function isReady() {
    return cvReady && !!window.cv && !!cv.Mat;
  }

  /**
   * Finds the four corners of the most likely document in the image.
   * Returns points in image pixel coordinates, ordered
   * [top-left, top-right, bottom-right, bottom-left], or null if nothing
   * confident was found.
   */
  function detectCorners(imgElement) {
    if (!window.cv || !cv.Mat) return null;

    const src = cv.imread(imgElement);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();

    let bestContour = null;
    let bestArea = 0;

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

      const imgArea = src.rows * src.cols;

      // Primary: brightness-contrast thresholding — a document is almost
      // always noticeably lighter or darker than what it's sitting on. Holds
      // up much better against a cluttered background than edges alone.
      for (const invert of [false, true]) {
        const found = findLargestThresholdCandidate(gray, imgArea, invert);
        if (found && found.area > bestArea) {
          if (bestContour) bestContour.delete();
          bestContour = found.contour;
          bestArea = found.area;
        } else if (found) {
          found.contour.delete();
        }
      }

      // Secondary: Canny edge detection, for cases with harsh/uneven
      // lighting where there isn't one clean brightness boundary.
      const thresholdPairs = [[60, 160], [30, 90], [90, 200]];
      for (const [low, high] of thresholdPairs) {
        const found = findLargestQuadCandidate(gray, blurred, low, high, imgArea);
        if (found && found.area > bestArea) {
          if (bestContour) bestContour.delete();
          bestContour = found.contour;
          bestArea = found.area;
        } else if (found) {
          found.contour.delete();
        }
      }

      if (!bestContour) return null;

      for (const epsilonFactor of [0.02, 0.035, 0.05]) {
        const peri = cv.arcLength(bestContour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(bestContour, approx, epsilonFactor * peri, true);
        if (approx.rows === 4) {
          const pts = [];
          for (let i = 0; i < 4; i++) {
            pts.push({ x: approx.data32S[i * 2], y: approx.data32S[i * 2 + 1] });
          }
          approx.delete();
          bestContour.delete();
          return orderCorners(pts);
        }
        approx.delete();
      }

      // Fallback: didn't simplify cleanly to 4 points — use the minimum-area
      // bounding rectangle of the winning contour instead.
      const rotatedRect = cv.minAreaRect(bestContour);
      bestContour.delete();
      return orderCorners(rotatedRectToPoints(rotatedRect));
    } finally {
      src.delete();
      gray.delete();
      blurred.delete();
    }
  }

  // Rejects candidates that are merely large without being roughly
  // rectangular (a shadow, reflection, or tabletop can out-size the actual
  // document) — comparing area to the contour's own bounding-box area
  // catches this cheaply.
  function isRectangleLike(contour, area) {
    const rect = cv.boundingRect(contour);
    const boxArea = rect.width * rect.height;
    if (boxArea === 0) return false;
    return area / boxArea > 0.55;
  }

  function findLargestThresholdCandidate(gray, imgArea, invert) {
    const thresh = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let winner = null, winnerArea = 0;

    try {
      const flags = cv.THRESH_OTSU | (invert ? cv.THRESH_BINARY_INV : cv.THRESH_BINARY);
      cv.threshold(gray, thresh, 0, 255, flags);

      const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.morphologyEx(thresh, thresh, cv.MORPH_CLOSE, kernel);
      kernel.delete();

      cv.findContours(thresh, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = Math.abs(cv.contourArea(contour));
        if (area > imgArea * 0.1 && area < imgArea * 0.98 && area > winnerArea && isRectangleLike(contour, area)) {
          if (winner) winner.delete();
          winner = contour.clone();
          winnerArea = area;
        }
        contour.delete();
      }
    } finally {
      thresh.delete(); contours.delete(); hierarchy.delete();
    }
    return winner ? { contour: winner, area: winnerArea } : null;
  }

  function findLargestQuadCandidate(gray, blurred, low, high, imgArea) {
    const edged = new cv.Mat();
    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    let winner = null, winnerArea = 0;

    try {
      cv.Canny(blurred, edged, low, high);
      const kernel = cv.Mat.ones(5, 5, cv.CV_8U);
      cv.dilate(edged, edged, kernel);
      kernel.delete();

      cv.findContours(edged, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE);

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = Math.abs(cv.contourArea(contour));
        if (area > imgArea * 0.1 && area < imgArea * 0.98 && area > winnerArea && isRectangleLike(contour, area)) {
          if (winner) winner.delete();
          winner = contour.clone();
          winnerArea = area;
        }
        contour.delete();
      }
    } finally {
      edged.delete(); contours.delete(); hierarchy.delete();
    }
    return winner ? { contour: winner, area: winnerArea } : null;
  }

  function rotatedRectToPoints(rect) {
    const angleRad = (rect.angle * Math.PI) / 180;
    const b = Math.cos(angleRad) * 0.5;
    const a = Math.sin(angleRad) * 0.5;
    const cx = rect.center.x, cy = rect.center.y;
    const w = rect.size.width, h = rect.size.height;
    const p0 = { x: cx - a * h - b * w, y: cy + b * h - a * w };
    const p1 = { x: cx + a * h - b * w, y: cy - b * h - a * w };
    const p2 = { x: 2 * cx - p0.x, y: 2 * cy - p0.y };
    const p3 = { x: 2 * cx - p1.x, y: 2 * cy - p1.y };
    return [p0, p1, p2, p3];
  }

  function orderCorners(pts) {
    const sum = pts.map((p) => p.x + p.y);
    const diff = pts.map((p) => p.x - p.y);
    const tl = pts[sum.indexOf(Math.min(...sum))];
    const br = pts[sum.indexOf(Math.max(...sum))];
    const tr = pts[diff.indexOf(Math.max(...diff))];
    const bl = pts[diff.indexOf(Math.min(...diff))];
    return [tl, tr, br, bl];
  }

  function defaultCorners(width, height) {
    const insetX = width * 0.08, insetY = height * 0.08;
    return [
      { x: insetX, y: insetY },
      { x: width - insetX, y: insetY },
      { x: width - insetX, y: height - insetY },
      { x: insetX, y: height - insetY }
    ];
  }

  function clampCorners(pts, width, height) {
    return pts.map((p) => ({
      x: Math.min(Math.max(p.x, 0), width),
      y: Math.min(Math.max(p.y, 0), height)
    }));
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  /**
   * Warps the quadrilateral defined by `corners` (image pixel coords,
   * TL/TR/BR/BL) into a flat rectangular canvas — the perspective-straighten
   * step. Sized to the longer detected edge so portrait/landscape both come
   * out undistorted.
   */
  function warpToCanvas(imgElement, corners) {
    const src = cv.imread(imgElement);

    const widthTop = dist(corners[0], corners[1]);
    const widthBottom = dist(corners[3], corners[2]);
    const heightLeft = dist(corners[0], corners[3]);
    const heightRight = dist(corners[1], corners[2]);

    const outWidth = Math.round(Math.max(widthTop, widthBottom));
    const outHeight = Math.round(Math.max(heightLeft, heightRight));

    const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      corners[0].x, corners[0].y, corners[1].x, corners[1].y,
      corners[2].x, corners[2].y, corners[3].x, corners[3].y
    ]);
    const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, outWidth, 0, outWidth, outHeight, 0, outHeight
    ]);

    const M = cv.getPerspectiveTransform(srcTri, dstTri);
    const dst = new cv.Mat();
    cv.warpPerspective(src, dst, M, new cv.Size(outWidth, outHeight), cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    const canvas = document.createElement("canvas");
    canvas.width = outWidth;
    canvas.height = outHeight;
    cv.imshow(canvas, dst);

    src.delete(); dst.delete(); M.delete(); srcTri.delete(); dstTri.delete();
    return canvas;
  }

  return { whenReady, isReady, detectCorners, defaultCorners, clampCorners, warpToCanvas, orderCorners };
})();

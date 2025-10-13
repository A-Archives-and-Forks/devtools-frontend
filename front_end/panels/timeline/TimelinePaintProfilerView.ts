// Copyright 2014 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/* eslint-disable rulesdir/no-imperative-dom-api */

import * as SDK from '../../core/sdk/sdk.js';
import type * as Protocol from '../../generated/protocol.js';
import * as Geometry from '../../models/geometry/geometry.js';
import * as Trace from '../../models/trace/trace.js';
import * as UI from '../../ui/legacy/legacy.js';
import * as Lit from '../../ui/lit/lit.js';
import * as LayerViewer from '../layer_viewer/layer_viewer.js';

import timelinePaintProfilerStyles from './timelinePaintProfiler.css.js';
import {TracingFrameLayerTree} from './TracingLayerTree.js';

const {html, render} = Lit;
const {createRef, ref} = Lit.Directives;

export class TimelinePaintProfilerView extends UI.SplitWidget.SplitWidget {
  private readonly logAndImageSplitWidget: UI.SplitWidget.SplitWidget;
  private readonly imageView: TimelinePaintImageView;
  private readonly paintProfilerView: LayerViewer.PaintProfilerView.PaintProfilerView;
  private readonly logTreeView: LayerViewer.PaintProfilerView.PaintProfilerCommandLogView;
  private needsUpdateWhenVisible: boolean;
  private pendingSnapshot: SDK.PaintProfiler.PaintProfilerSnapshot|null;
  private event: Trace.Types.Events.Event|null;
  private paintProfilerModel: SDK.PaintProfiler.PaintProfilerModel|null;
  private lastLoadedSnapshot: SDK.PaintProfiler.PaintProfilerSnapshot|null;
  #parsedTrace: Trace.TraceModel.ParsedTrace;

  constructor(parsedTrace: Trace.TraceModel.ParsedTrace) {
    super(false, false);
    this.setSidebarSize(60);
    this.setResizable(false);

    this.#parsedTrace = parsedTrace;

    this.logAndImageSplitWidget = new UI.SplitWidget.SplitWidget(true, false, 'timeline-paint-profiler-log-split');
    this.setMainWidget(this.logAndImageSplitWidget);
    this.imageView = new TimelinePaintImageView();
    this.logAndImageSplitWidget.setMainWidget(this.imageView);

    this.paintProfilerView =
        new LayerViewer.PaintProfilerView.PaintProfilerView(this.imageView.showImage.bind(this.imageView));
    this.paintProfilerView.addEventListener(
        LayerViewer.PaintProfilerView.Events.WINDOW_CHANGED, this.onWindowChanged, this);
    this.setSidebarWidget(this.paintProfilerView);

    this.logTreeView = new LayerViewer.PaintProfilerView.PaintProfilerCommandLogView();
    this.logAndImageSplitWidget.setSidebarWidget(this.logTreeView);

    this.needsUpdateWhenVisible = false;
    this.pendingSnapshot = null;
    this.event = null;
    this.paintProfilerModel = null;
    this.lastLoadedSnapshot = null;
  }

  override wasShown(): void {
    super.wasShown();
    if (this.needsUpdateWhenVisible) {
      this.needsUpdateWhenVisible = false;
      this.update();
    }
  }

  setSnapshot(snapshot: SDK.PaintProfiler.PaintProfilerSnapshot): void {
    this.releaseSnapshot();
    this.pendingSnapshot = snapshot;
    this.event = null;
    this.updateWhenVisible();
  }

  #rasterEventHasTile(event: Trace.Types.Events.RasterTask): boolean {
    const data = event.args.tileData;
    if (!data) {
      return false;
    }

    const frame = this.#parsedTrace.data.Frames.framesById[data.sourceFrameNumber];
    if (!frame?.layerTree) {
      return false;
    }
    return true;
  }

  setEvent(paintProfilerModel: SDK.PaintProfiler.PaintProfilerModel, event: Trace.Types.Events.Event): boolean {
    this.releaseSnapshot();
    this.paintProfilerModel = paintProfilerModel;
    this.pendingSnapshot = null;
    this.event = event;

    this.updateWhenVisible();
    if (Trace.Types.Events.isPaint(event)) {
      const snapshot = this.#parsedTrace.data.LayerTree.paintsToSnapshots.get(event);
      return Boolean(snapshot);
    }
    if (Trace.Types.Events.isRasterTask(event)) {
      return this.#rasterEventHasTile(event);
    }
    return false;
  }

  private updateWhenVisible(): void {
    if (this.isShowing()) {
      this.update();
    } else {
      this.needsUpdateWhenVisible = true;
    }
  }

  async #rasterTilePromise(rasterEvent: Trace.Types.Events.RasterTask): Promise<{
    rect: Protocol.DOM.Rect,
    snapshot: SDK.PaintProfiler.PaintProfilerSnapshot,
  }|null> {
    const data = rasterEvent.args.tileData;
    if (!data) {
      return null;
    }

    if (!data.tileId.id_ref) {
      return null;
    }

    const target = SDK.TargetManager.TargetManager.instance().rootTarget();
    if (!target) {
      return null;
    }

    const frame = this.#parsedTrace.data.Frames.framesById[data.sourceFrameNumber];
    if (!frame?.layerTree) {
      return null;
    }

    const layerTree = new TracingFrameLayerTree(
        target,
        frame.layerTree,
    );
    const tracingLayerTree = await layerTree.layerTreePromise();
    return tracingLayerTree ? await tracingLayerTree.pictureForRasterTile(data.tileId.id_ref) : null;
  }

  update(): void {
    this.logTreeView.setCommandLog([]);
    void this.paintProfilerView.setSnapshotAndLog(null, [], null);

    let snapshotPromise: Promise<{
      rect: Protocol.DOM.Rect | null,
      snapshot: SDK.PaintProfiler.PaintProfilerSnapshot,
    }|null>;
    if (this.pendingSnapshot) {
      snapshotPromise = Promise.resolve({rect: null, snapshot: this.pendingSnapshot});
    } else if (this.event && this.paintProfilerModel && Trace.Types.Events.isPaint(this.event)) {
      // When we process events (TimelineModel#processEvent) and find a
      // snapshot event, we look for the last paint that occurred and link the
      // snapshot to that paint event. That is why here if the event is a Paint
      // event, we look to see if it has had a matching picture event set for
      // it.
      const snapshotEvent = this.#parsedTrace.data.LayerTree.paintsToSnapshots.get(this.event);
      if (snapshotEvent) {
        const encodedData = snapshotEvent.args.snapshot.skp64;
        snapshotPromise = this.paintProfilerModel.loadSnapshot(encodedData).then(snapshot => {
          return snapshot && {rect: null, snapshot};
        });
      } else {
        snapshotPromise = Promise.resolve(null);
      }

    } else if (this.event && Trace.Types.Events.isRasterTask(this.event)) {
      snapshotPromise = this.#rasterTilePromise(this.event);
    } else {
      console.assert(false, 'Unexpected event type or no snapshot');
      return;
    }
    void snapshotPromise.then(snapshotWithRect => {
      this.releaseSnapshot();
      if (!snapshotWithRect) {
        this.imageView.showImage();
        return;
      }
      const snapshot = snapshotWithRect.snapshot;
      this.lastLoadedSnapshot = snapshot;
      this.imageView.setMask(snapshotWithRect.rect);
      void snapshot.commandLog().then(log => onCommandLogDone.call(this, snapshot, snapshotWithRect.rect, log || []));
    });

    function onCommandLogDone(
        this: TimelinePaintProfilerView, snapshot: SDK.PaintProfiler.PaintProfilerSnapshot,
        clipRect: Protocol.DOM.Rect|null, log?: SDK.PaintProfiler.PaintProfilerLogItem[]): void {
      this.logTreeView.setCommandLog(log || []);
      void this.paintProfilerView.setSnapshotAndLog(snapshot, log || [], clipRect);
    }
  }

  private releaseSnapshot(): void {
    if (!this.lastLoadedSnapshot) {
      return;
    }
    this.lastLoadedSnapshot.release();
    this.lastLoadedSnapshot = null;
  }

  private onWindowChanged(): void {
    this.logTreeView.updateWindow(this.paintProfilerView.selectionWindow());
  }
}

export interface TimelinePaintImageViewInput {
  maskElementHidden: boolean;
  imageContainerHidden: boolean;
  imageURL: string;
  imageContainerWebKitTransform: string;
  maskElementStyle: {
    width?: string,
    height?: string,
    borderLeftWidth?: string,
    borderTopWidth?: string,
    borderRightWidth?: string,
    borderBottomWidth?: string,
  };
}

export const DEFAULT_VIEW = (input: TimelinePaintImageViewInput, output: undefined, target: HTMLElement): {
  imageElementNaturalHeight: number,
  imageElementNaturalWidth: number,
} => {
  const imageElementRef = createRef<HTMLImageElement>();
  // clang-format off
  render(html`
  <div class="paint-profiler-image-view fill">
    <div class="paint-profiler-image-container" style="-webkit-transform: ${input.imageContainerWebKitTransform}">
      <img src=${input.imageURL} display=${input.imageContainerHidden ? 'none' : 'block'} ${ref(imageElementRef)}>
      <div style=${Lit.Directives.styleMap({
        display: input.maskElementHidden ? 'none' : 'block',
        ...input.maskElementStyle,})}>
      </div>
    </div>
  </div>`,
 target);
  // clang-format on

  // The elements are guaranteed to exist after render completes
  // because they are not conditionally rendered within the template.
  const imageElement = imageElementRef.value;

  if (!imageElement?.naturalHeight || !imageElement.naturalWidth) {
    throw new Error('ImageElement were not found in the TimelinePaintImageView.');
  }

  return {imageElementNaturalHeight: imageElement.naturalHeight, imageElementNaturalWidth: imageElement.naturalWidth};
};
export class TimelinePaintImageView extends UI.Widget.Widget {
  private transformController: LayerViewer.TransformController.TransformController;
  private maskRectangle?: Protocol.DOM.Rect|null;

  #inputData: TimelinePaintImageViewInput = {
    maskElementHidden: true,
    imageContainerHidden: true,
    imageURL: '',
    imageContainerWebKitTransform: '',
    maskElementStyle: {},
  };

  #view: typeof DEFAULT_VIEW;
  #imageElementDimensions?: {
    naturalHeight: number,
    naturalWidth: number,
  };

  constructor(view = DEFAULT_VIEW) {
    super();
    this.registerRequiredCSS(timelinePaintProfilerStyles);
    this.#view = view;
    this.transformController = new LayerViewer.TransformController.TransformController((this.contentElement), true);
    this.transformController.addEventListener(
        LayerViewer.TransformController.Events.TRANSFORM_CHANGED, this.updateImagePosition, this);
  }

  override onResize(): void {
    this.requestUpdate();
    this.updateImagePosition();
  }

  private updateImagePosition(): void {
    if (!this.#imageElementDimensions) {
      return;
    }

    const width = this.#imageElementDimensions.naturalWidth;
    const height = this.#imageElementDimensions.naturalHeight;
    const clientWidth = this.contentElement.clientWidth;
    const clientHeight = this.contentElement.clientHeight;

    const paddingFraction = 0.1;
    const paddingX = clientWidth * paddingFraction;
    const scale = clientHeight / height;

    const oldMaskStyle = JSON.stringify(this.#inputData.maskElementStyle);
    let newMaskStyle = {};
    if (this.maskRectangle) {
      newMaskStyle = {
        width: width + 'px',
        height: height + 'px',
        borderLeftWidth: this.maskRectangle.x + 'px',
        borderTopWidth: this.maskRectangle.y + 'px',
        borderRightWidth: (width - this.maskRectangle.x - this.maskRectangle.width) + 'px',
        borderBottomWidth: (height - this.maskRectangle.y - this.maskRectangle.height) + 'px',
      };
    }
    this.#inputData.maskElementStyle = newMaskStyle;

    if (!this.transformController) {
      return;
    }
    this.transformController.setScaleConstraints(0.5, 10 / scale);
    let matrix = new WebKitCSSMatrix()
                     .scale(this.transformController.scale(), this.transformController.scale())
                     .translate(clientWidth / 2, clientHeight / 2)
                     .scale(scale, scale)
                     .translate(-width / 2, -height / 2);
    const bounds = Geometry.boundsForTransformedPoints(matrix, [0, 0, 0, width, height, 0]);
    this.transformController.clampOffsets(paddingX - bounds.maxX, clientWidth - paddingX - bounds.minX, 0, 0);
    matrix = new WebKitCSSMatrix()
                 .translate(this.transformController.offsetX(), this.transformController.offsetY())
                 .multiply(matrix);

    const oldTransform = this.#inputData.imageContainerWebKitTransform;
    const newTransform = matrix.toString();
    this.#inputData.imageContainerWebKitTransform = newTransform;

    if (oldTransform !== newTransform || oldMaskStyle !== JSON.stringify(newMaskStyle)) {
      this.requestUpdate();
    }
  }

  showImage(imageURL?: string): void {
    this.#inputData.imageContainerHidden = !imageURL;
    if (imageURL) {
      this.#inputData.imageURL = imageURL;
    }
    this.requestUpdate();
  }

  setMask(maskRectangle: Protocol.DOM.Rect|null): void {
    this.maskRectangle = maskRectangle;

    this.#inputData.maskElementHidden = !maskRectangle;
    this.requestUpdate();
  }

  override performUpdate(): void {
    const {imageElementNaturalHeight, imageElementNaturalWidth} =
        this.#view(this.#inputData, undefined, this.contentElement);
    this.#imageElementDimensions = {naturalHeight: imageElementNaturalHeight, naturalWidth: imageElementNaturalWidth};
    // Image can only be updated to correctly fit the component when the component has loaded.
    this.updateImagePosition();
  }
}

// Copyright 2017 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.
/* eslint-disable rulesdir/no-imperative-dom-api */
/* eslint-disable rulesdir/no-lit-render-outside-of-view */

import * as Common from '../../core/common/common.js';
import * as i18n from '../../core/i18n/i18n.js';
import type * as Platform from '../../core/platform/platform.js';
import * as TextUtils from '../../models/text_utils/text_utils.js';
import * as Workspace from '../../models/workspace/workspace.js';
import * as DataGrid from '../../ui/legacy/components/data_grid/data_grid.js';
import * as UI from '../../ui/legacy/legacy.js';
import {Directives, html, nothing, render} from '../../ui/lit/lit.js';

import coverageListViewStyles from './coverageListView.css.js';
import {
  CoverageType,
  SourceURLCoverageInfo,
  type URLCoverageInfo,
} from './CoverageModel.js';

const UIStrings = {
  /**
   * @description Text that appears on a button for the css resource type filter.
   */
  css: 'CSS',
  /**
   * @description Text in Coverage List View of the Coverage tab
   */
  jsPerFunction: 'JS (per function)',
  /**
   * @description Text in Coverage List View of the Coverage tab
   */
  jsPerBlock: 'JS (per block)',
  /**
   * @description Text for web URLs
   */
  url: 'URL',
  /**
   * @description Text that refers to some types
   */
  type: 'Type',
  /**
   * @description Text in Coverage List View of the Coverage tab
   */
  totalBytes: 'Total Bytes',
  /**
   * @description Text in Coverage List View of the Coverage tab
   */
  unusedBytes: 'Unused Bytes',
  /**
   * @description Text in the Coverage List View of the Coverage Tab
   */
  usageVisualization: 'Usage Visualization',
  /**
   * @description Data grid name for Coverage data grids
   */
  codeCoverage: 'Code Coverage',
  /**
   * @description Cell title in Coverage List View of the Coverage tab. The coverage tool tells
   *developers which functions (logical groups of lines of code) were actually run/executed. If a
   *function does get run, then it is marked in the UI to indicate that it was covered.
   */
  jsCoverageWithPerFunction:
      'JS coverage with per function granularity: Once a function was executed, the whole function is marked as covered.',
  /**
   * @description Cell title in Coverage List View of the Coverage tab. The coverage tool tells
   *developers which blocks (logical groups of lines of code, smaller than a function) were actually
   *run/executed. If a block does get run, then it is marked in the UI to indicate that it was
   *covered.
   */
  jsCoverageWithPerBlock:
      'JS coverage with per block granularity: Once a block of JavaScript was executed, that block is marked as covered.',
  /**
   * @description Accessible text for the value in bytes in memory allocation or coverage view.
   */
  sBytes: '{n, plural, =1 {# byte} other {# bytes}}',
  /**
   * @description Accessible text for the unused bytes column in the coverage tool that describes the total unused bytes and percentage of the file unused.
   * @example {88%} percentage
   */
  sBytesS: '{n, plural, =1 {# byte, {percentage}} other {# bytes, {percentage}}}',
  /**
   * @description Tooltip text for the bar in the coverage list view of the coverage tool that illustrates the relation between used and unused bytes.
   * @example {1000} PH1
   * @example {12.34} PH2
   */
  sBytesSBelongToFunctionsThatHave: '{PH1} bytes ({PH2}) belong to functions that have not (yet) been executed.',
  /**
   * @description Tooltip text for the bar in the coverage list view of the coverage tool that illustrates the relation between used and unused bytes.
   * @example {1000} PH1
   * @example {12.34} PH2
   */
  sBytesSBelongToBlocksOf: '{PH1} bytes ({PH2}) belong to blocks of JavaScript that have not (yet) been executed.',
  /**
   * @description Message in Coverage View of the Coverage tab
   * @example {1000} PH1
   * @example {12.34} PH2
   */
  sBytesSBelongToFunctionsThatHaveExecuted: '{PH1} bytes ({PH2}) belong to functions that have executed at least once.',
  /**
   * @description Message in Coverage View of the Coverage tab
   * @example {1000} PH1
   * @example {12.34} PH2
   */
  sBytesSBelongToBlocksOfJavascript:
      '{PH1} bytes ({PH2}) belong to blocks of JavaScript that have executed at least once.',
  /**
   * @description Accessible text for the visualization column of coverage tool. Contains percentage of unused bytes to used bytes.
   * @example {12.3} PH1
   * @example {12.3} PH2
   */
  sOfFileUnusedSOfFileUsed: '{PH1} % of file unused, {PH2} % of file used',
} as const;
const str_ = i18n.i18n.registerUIStrings('panels/coverage/CoverageListView.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);
const {styleMap} = Directives;

export function coverageTypeToString(type: CoverageType): string {
  const types = [];
  if (type & CoverageType.CSS) {
    types.push(i18nString(UIStrings.css));
  }
  if (type & CoverageType.JAVA_SCRIPT_PER_FUNCTION) {
    types.push(i18nString(UIStrings.jsPerFunction));
  } else if (type & CoverageType.JAVA_SCRIPT) {
    types.push(i18nString(UIStrings.jsPerBlock));
  }
  return types.join('+');
}

export class CoverageListView extends UI.Widget.VBox {
  private readonly nodeForCoverageInfo: Map<URLCoverageInfo, GridNode>;
  private readonly isVisibleFilter: (arg0: URLCoverageInfo) => boolean;
  private highlightRegExp: RegExp|null;
  private dataGrid: DataGrid.SortableDataGrid.SortableDataGrid<GridNode>;

  constructor(isVisibleFilter: (arg0: URLCoverageInfo) => boolean) {
    super({useShadowDom: true});
    this.registerRequiredCSS(coverageListViewStyles);
    this.nodeForCoverageInfo = new Map();
    this.isVisibleFilter = isVisibleFilter;
    this.highlightRegExp = null;

    const columns = [
      {
        id: 'url',
        title: i18nString(UIStrings.url),
        width: '250px',
        weight: 3,
        fixedWidth: false,
        sortable: true,
        disclosure: true,
      },
      {id: 'type', title: i18nString(UIStrings.type), width: '45px', weight: 1, fixedWidth: true, sortable: true},
      {
        id: 'size',
        title: i18nString(UIStrings.totalBytes),
        width: '60px',
        fixedWidth: true,
        sortable: true,
        align: DataGrid.DataGrid.Align.RIGHT,
        weight: 1,
      },
      {
        id: 'unused-size',
        title: i18nString(UIStrings.unusedBytes),
        width: '100px',
        fixedWidth: true,
        sortable: true,
        align: DataGrid.DataGrid.Align.RIGHT,
        sort: DataGrid.DataGrid.Order.Descending,
        weight: 1,
      },
      {
        id: 'bars',
        title: i18nString(UIStrings.usageVisualization),
        width: '250px',
        fixedWidth: false,
        sortable: true,
        weight: 1,
      },
    ] as DataGrid.DataGrid.ColumnDescriptor[];
    this.dataGrid =
        DataGrid.SortableDataGrid.SortableDataGrid.create(['dummy'], [], i18nString(UIStrings.codeCoverage)) as
        DataGrid.SortableDataGrid.SortableDataGrid<GridNode>;
    this.dataGrid.removeColumn('dummy');
    for (const column of columns) {
      this.dataGrid.addColumn(column);
    }
    this.dataGrid.setColumnsVisibility(new Set(columns.map(column => column.id)));
    this.dataGrid.setResizeMethod(DataGrid.DataGrid.ResizeMethod.LAST);
    this.dataGrid.setStriped(true);
    this.dataGrid.element.classList.add('flex-auto');
    this.dataGrid.addEventListener(DataGrid.DataGrid.Events.OPENED_NODE, this.onOpenedNode, this);

    const dataGridWidget = this.dataGrid.asWidget();
    dataGridWidget.show(this.contentElement);
    this.setDefaultFocusedChild(dataGridWidget);
  }

  update(coverageInfo: URLCoverageInfo[] = []): void {
    let hadUpdates = false;
    const maxSize = coverageInfo.reduce((acc, entry) => Math.max(acc, entry.size()), 0);
    const rootNode = this.dataGrid.rootNode();
    for (const entry of coverageInfo) {
      let node = this.nodeForCoverageInfo.get(entry);
      if (node) {
        if (this.isVisibleFilter(node.coverageInfo)) {
          hadUpdates = node.refreshIfNeeded(maxSize) || hadUpdates;
          if (entry.sourcesURLCoverageInfo.size > 0) {
            this.updateSourceNodes(entry.sourcesURLCoverageInfo, maxSize, node);
          }
        }
        continue;
      }
      node = new GridNode(entry, maxSize);
      this.nodeForCoverageInfo.set(entry, node);
      if (this.isVisibleFilter(node.coverageInfo)) {
        rootNode.appendChild(node);
        if (entry.sourcesURLCoverageInfo.size > 0) {
          void this.createSourceNodes(entry.sourcesURLCoverageInfo, maxSize, node);
        }
        hadUpdates = true;
      }
    }
    if (hadUpdates) {
      this.dataGrid.dispatchEventToListeners(DataGrid.DataGrid.Events.SORTING_CHANGED);
    }
  }

  updateSourceNodes(
      sourcesURLCoverageInfo: Map<Platform.DevToolsPath.UrlString, SourceURLCoverageInfo>, maxSize: number,
      node: GridNode): void {
    let shouldCreateSourceNodes = false;
    for (const coverageInfo of sourcesURLCoverageInfo.values()) {
      const sourceNode = this.nodeForCoverageInfo.get(coverageInfo);
      if (sourceNode) {
        sourceNode.refreshIfNeeded(maxSize);
      } else {
        shouldCreateSourceNodes = true;
        break;
      }
    }
    if (shouldCreateSourceNodes) {
      void this.createSourceNodes(sourcesURLCoverageInfo, maxSize, node);
    }
  }

  async createSourceNodes(
      sourcesURLCoverageInfo: Map<Platform.DevToolsPath.UrlString, SourceURLCoverageInfo>, maxSize: number,
      node: GridNode): Promise<void> {
    for (const coverageInfo of sourcesURLCoverageInfo.values()) {
      const sourceNode = new GridNode(coverageInfo, maxSize);
      node.appendChild(sourceNode);
      this.nodeForCoverageInfo.set(coverageInfo, sourceNode);
    }
  }

  reset(): void {
    this.nodeForCoverageInfo.clear();
    this.dataGrid.rootNode().removeChildren();
  }

  updateFilterAndHighlight(highlightRegExp: RegExp|null): void {
    this.highlightRegExp = highlightRegExp;
    let hadTreeUpdates = false;
    for (const node of this.nodeForCoverageInfo.values()) {
      const shouldBeVisible = this.isVisibleFilter(node.coverageInfo);
      const isVisible = Boolean(node.parent);
      if (shouldBeVisible) {
        node.setHighlight(this.highlightRegExp);
      }
      if (shouldBeVisible === isVisible) {
        continue;
      }
      hadTreeUpdates = true;
      if (!shouldBeVisible) {
        node.remove();
      } else {
        this.appendNodeByType(node);
      }
    }
    if (hadTreeUpdates) {
      this.dataGrid.dispatchEventToListeners(DataGrid.DataGrid.Events.SORTING_CHANGED);
    }
  }

  private appendNodeByType(node: GridNode): void {
    if (node.coverageInfo instanceof SourceURLCoverageInfo) {
      const parentNode = this.nodeForCoverageInfo.get(node.coverageInfo.generatedURLCoverageInfo);
      parentNode?.appendChild(node);
    } else {
      this.dataGrid.rootNode().appendChild(node);
    }
  }

  selectByUrl(url: string): void {
    for (const [info, node] of this.nodeForCoverageInfo.entries()) {
      if (info.url() === url) {
        node.revealAndSelect();
        break;
      }
    }
  }

  private onOpenedNode(): void {
    void this.revealSourceForSelectedNode();
  }

  private async revealSourceForSelectedNode(): Promise<void> {
    const node = this.dataGrid.selectedNode;
    if (!node) {
      return;
    }
    const coverageInfo = (node as GridNode).coverageInfo;
    const sourceCode = Workspace.Workspace.WorkspaceImpl.instance().uiSourceCodeForURL(coverageInfo.url());
    if (!sourceCode) {
      return;
    }

    if (this.dataGrid.selectedNode !== node) {
      return;
    }
    void Common.Revealer.reveal(sourceCode);
  }

}

let percentageFormatter: Intl.NumberFormat|null = null;

function getPercentageFormatter(): Intl.NumberFormat {
  if (!percentageFormatter) {
    percentageFormatter = new Intl.NumberFormat(i18n.DevToolsLocale.DevToolsLocale.instance().locale, {
      style: 'percent',
      maximumFractionDigits: 1,
    });
  }
  return percentageFormatter;
}

let bytesFormatter: Intl.NumberFormat|null = null;

function getBytesFormatter(): Intl.NumberFormat {
  if (!bytesFormatter) {
    bytesFormatter = new Intl.NumberFormat(i18n.DevToolsLocale.DevToolsLocale.instance().locale);
  }
  return bytesFormatter;
}

export class GridNode extends DataGrid.SortableDataGrid.SortableDataGridNode<GridNode> {
  coverageInfo: URLCoverageInfo;
  private lastUsedSize!: number|undefined;
  private url: Platform.DevToolsPath.UrlString;
  private maxSize: number;
  private highlightRegExp: RegExp|null;

  constructor(coverageInfo: URLCoverageInfo, maxSize: number) {
    super();
    this.coverageInfo = coverageInfo;
    this.url = coverageInfo.url();
    this.maxSize = maxSize;
    this.highlightRegExp = null;
    this.#updateData();
  }

  #updateData(): void {
    this.data['url'] = this.url;
    this.data['type'] = coverageTypeToString(this.coverageInfo.type());
    this.data['size'] = this.coverageInfo.size();
    this.data['unused-size'] = this.coverageInfo.unusedSize();
    this.data['bars'] = this.coverageInfo.unusedSize();
  }

  setHighlight(highlightRegExp: RegExp|null): void {
    if (this.highlightRegExp === highlightRegExp) {
      return;
    }
    this.highlightRegExp = highlightRegExp;
    this.refresh();
  }

  refreshIfNeeded(maxSize: number): boolean {
    if (this.lastUsedSize === this.coverageInfo.usedSize() && maxSize === this.maxSize) {
      return false;
    }
    this.lastUsedSize = this.coverageInfo.usedSize();
    this.maxSize = maxSize;
    this.refresh();
    this.#updateData();
    return true;
  }

  override createCell(columnId: string): HTMLElement {
    const cell = this.createTD(columnId);
    const info = this.coverageInfo;
    const formatBytes = (value: number|undefined): string => {
      return getBytesFormatter().format(value ?? 0);
    };
    const formatPercent = (value: number|undefined): string => {
      return getPercentageFormatter().format(value ?? 0);
    };
    switch (columnId) {
      case 'url': {
        UI.Tooltip.Tooltip.install(cell, this.url);
        this.setCellAccessibleName(this.url, cell, columnId);
        const splitURL = /^(.*)(\/[^/]*)$/.exec(this.url);
        render(
            html`
          <div class="url-outer">
            <div class="url-prefix">${splitURL ? splitURL[1] : this.url}</div>
            <div class="url-suffix">${splitURL ? splitURL[2] : ''}</div>
          </div>`,
            cell);
        if (this.highlightRegExp) {
          this.highlight(cell, this.url);
        }
        break;
      }
      case 'type': {
        UI.Tooltip.Tooltip.install(
            cell,
            info.type() & CoverageType.JAVA_SCRIPT_PER_FUNCTION ? i18nString(UIStrings.jsCoverageWithPerFunction) :
                info.type() & CoverageType.JAVA_SCRIPT          ? i18nString(UIStrings.jsCoverageWithPerBlock) :
                                                                  '');
        render(coverageTypeToString(this.coverageInfo.type()), cell);
        break;
      }
      case 'size': {
        this.setCellAccessibleName(i18nString(UIStrings.sBytes, {n: info.size() || 0}), cell, columnId);
        render(html`<span>${formatBytes(info.size())}</span>`, cell);
        break;
      }
      case 'unused-size': {
        this.setCellAccessibleName(
            i18nString(UIStrings.sBytesS, {n: info.unusedSize(), percentage: formatPercent(info.unusedPercentage())}),
            cell, columnId);
        // clang-format off
        render(html`
          <span>${formatBytes(info.unusedSize())}</span>
          <span class="percent-value">
            ${formatPercent(info.unusedPercentage())}
          </span>`, cell);
        // clang-format on
        break;
      }
      case 'bars': {
        this.setCellAccessibleName(
            i18nString(
                UIStrings.sOfFileUnusedSOfFileUsed,
                {PH1: formatPercent(info.unusedPercentage()), PH2: formatPercent(info.usedPercentage())}),
            cell, columnId);
        // clang-format off
        render(html`
          <div class="bar-container">
            ${info.unusedSize() > 0 ? html`
              <div class="bar bar-unused-size"
                  title=${
                    info.type() & CoverageType.JAVA_SCRIPT_PER_FUNCTION ? i18nString(UIStrings.sBytesSBelongToFunctionsThatHave, {PH1: info.unusedSize(), PH2: formatPercent(info.unusedPercentage())}) :
                    info.type() & CoverageType.JAVA_SCRIPT              ? i18nString(UIStrings.sBytesSBelongToBlocksOf, {PH1: info.unusedSize(), PH2: formatPercent(info.unusedPercentage())}) :
                                                                          ''}
                  style=${styleMap({width: ((info.unusedSize() / this.maxSize) * 100 || 0) + '%'})}>
              </div>` : nothing}
            ${info.usedSize() > 0 ? html`
            <div class="bar bar-used-size"
                  title=${
                    info.type() & CoverageType.JAVA_SCRIPT_PER_FUNCTION ? i18nString(UIStrings.sBytesSBelongToFunctionsThatHaveExecuted, {PH1: info.usedSize(), PH2: formatPercent(info.usedPercentage())}) :
                    info.type() & CoverageType.JAVA_SCRIPT              ? i18nString(UIStrings.sBytesSBelongToBlocksOfJavascript, {PH1: info.usedSize(), PH2: formatPercent(info.usedPercentage())}) :
                                                                          ''}
                  { PH1: info.usedSize(), PH2: formatPercent(info.usedPercentage()) })}
                style=${styleMap({width:((info.usedSize() / this.maxSize) * 100 || 0) + '%'})}>
            </div>` : nothing}
          </div>`, cell);
        // clang-format on
      }
    }
    return cell;
  }

  private highlight(element: Element, textContent: string): void {
    if (!this.highlightRegExp) {
      return;
    }
    const matches = this.highlightRegExp.exec(textContent);
    if (!matches?.length) {
      return;
    }
    const range = new TextUtils.TextRange.SourceRange(matches.index, matches[0].length);
    UI.UIUtils.highlightRangesWithStyleClass(element, [range], 'filter-highlight');
  }

}

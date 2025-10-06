// Copyright 2017 The Chromium Authors
// Use of this source code is governed by a BSD-style license that can be
// found in the LICENSE file.

import '../../ui/legacy/legacy.js';

import * as i18n from '../../core/i18n/i18n.js';
import type * as Platform from '../../core/platform/platform.js';
import type * as Workspace from '../../models/workspace/workspace.js';
import * as WorkspaceDiff from '../../models/workspace_diff/workspace_diff.js';
import * as UI from '../../ui/legacy/legacy.js';
import * as Lit from '../../ui/lit/lit.js';
import * as VisualLogging from '../../ui/visual_logging/visual_logging.js';

import {ChangesSidebar, Events} from './ChangesSidebar.js';
import changesViewStyles from './changesView.css.js';
import * as CombinedDiffView from './CombinedDiffView.js';

const CHANGES_VIEW_URL = 'https://developer.chrome.com/docs/devtools/changes' as Platform.DevToolsPath.UrlString;

const UIStrings = {
  /**
   * @description Text in Changes View of the Changes tab if no change has been made so far.
   */
  noChanges: 'No changes yet',
  /**
   * @description Text in Changes View of the Changes tab to explain the Changes panel.
   */
  changesViewDescription: 'On this page you can track code changes made within DevTools.',
} as const;
const str_ = i18n.i18n.registerUIStrings('panels/changes/ChangesView.ts', UIStrings);
const i18nString = i18n.i18n.getLocalizedString.bind(undefined, str_);
const {render, html} = Lit;
interface ViewInput {
  selectedSourceCode: Workspace.UISourceCode.UISourceCode|null;
  onSelect(sourceCode: Workspace.UISourceCode.UISourceCode|null): void;
  workspaceDiff: WorkspaceDiff.WorkspaceDiff.WorkspaceDiffImpl;
}
type View = (input: ViewInput, output: object, target: HTMLElement) => void;
export const DEFAULT_VIEW: View = (input, output, target) => {
  const onSidebar = (sidebar: ChangesSidebar): void => {
    sidebar.addEventListener(
        Events.SELECTED_UI_SOURCE_CODE_CHANGED, () => input.onSelect(sidebar.selectedUISourceCode()));
  };
  render(
      // clang-format off
      html`
      <style>${changesViewStyles}</style>
      <devtools-split-view direction=column>
        <div class=vbox slot="main">
          <devtools-widget
            ?hidden=${input.workspaceDiff.modifiedUISourceCodes().length > 0}
            .widgetConfig=${UI.Widget.widgetConfig(UI.EmptyWidget.EmptyWidget, {
                              header: i18nString(UIStrings.noChanges),
                              text: i18nString(UIStrings.changesViewDescription),
                              link: CHANGES_VIEW_URL,
                            })}>
          </devtools-widget>
          <div class=diff-container role=tabpanel ?hidden=${input.workspaceDiff.modifiedUISourceCodes().length === 0}>
            <devtools-widget .widgetConfig=${UI.Widget.widgetConfig(CombinedDiffView.CombinedDiffView, {
                                              selectedFileUrl: input.selectedSourceCode?.url(),
                                              workspaceDiff: input.workspaceDiff
                                            })}></devtools-widget>
          </div>
        </div>
        <devtools-widget
          slot="sidebar"
          .widgetConfig=${UI.Widget.widgetConfig(ChangesSidebar, {
                           workspaceDiff: input.workspaceDiff
                         })}
          ${UI.Widget.widgetRef(ChangesSidebar, onSidebar)}>
        </devtools-widget>
      </devtools-split-view>`,
      // clang-format on
      target);
};

export class ChangesView extends UI.Widget.VBox {
  readonly #workspaceDiff: WorkspaceDiff.WorkspaceDiff.WorkspaceDiffImpl;
  #selectedUISourceCode: Workspace.UISourceCode.UISourceCode|null = null;
  readonly #view: View;

  constructor(target?: HTMLElement, view = DEFAULT_VIEW) {
    super(target, {
      jslog: `${VisualLogging.panel('changes').track({resize: true})}`,
      useShadowDom: true,
    });

    this.#workspaceDiff = WorkspaceDiff.WorkspaceDiff.workspaceDiff();
    this.#view = view;

    this.requestUpdate();
  }

  override performUpdate(): void {
    this.#view(
        {
          workspaceDiff: this.#workspaceDiff,
          selectedSourceCode: this.#selectedUISourceCode,
          onSelect: sourceCode => {
            this.#selectedUISourceCode = sourceCode;
            this.requestUpdate();
          },
        },
        {}, this.contentElement);
  }

  override wasShown(): void {
    UI.Context.Context.instance().setFlavor(ChangesView, this);
    super.wasShown();
    this.requestUpdate();
    this.#workspaceDiff.addEventListener(
        WorkspaceDiff.WorkspaceDiff.Events.MODIFIED_STATUS_CHANGED, this.requestUpdate, this);
  }

  override willHide(): void {
    super.willHide();
    UI.Context.Context.instance().setFlavor(ChangesView, null);
    this.#workspaceDiff.removeEventListener(
        WorkspaceDiff.WorkspaceDiff.Events.MODIFIED_STATUS_CHANGED, this.requestUpdate, this);
  }
}

import assert from "node:assert";
import React from "react";
import {
  createViewRegistry,
  type CanvasViewComponent,
  type CanvasViewContext,
} from "../../src/ui/react";
import type { CanvasState } from "../../src/ui";

console.log("🧪 Testing avantgate/ui/react: View Registry & CanvasRenderer...");

interface TestAppMap {
  card_view: { title: string; score: number };
  table_view: { rows: string[] };
}

let lastRenderedProps: any = null;

const CardView: CanvasViewComponent<TestAppMap["card_view"]> = (props) => {
  lastRenderedProps = props;
  return React.createElement("div", null, props.data.title);
};

const TableView: CanvasViewComponent<TestAppMap["table_view"]> = (props) => {
  lastRenderedProps = props;
  return React.createElement("div", null, `Rows: ${props.data.rows.length}`);
};

const { registry, CanvasRenderer } = createViewRegistry<TestAppMap>({
  card_view: CardView,
  table_view: TableView,
});

const testNullAndUndefinedSafety = (): void => {
  lastRenderedProps = null;

  const res1 = CanvasRenderer({ state: null });
  assert.strictEqual(res1, null);

  const res2 = CanvasRenderer({ state: undefined });
  assert.strictEqual(res2, null);

  const res3 = CanvasRenderer({ state: { content: null } });
  assert.strictEqual(res3, null);

  const res4 = CanvasRenderer({
    state: { content: { kind: "unregistered_kind" as any } },
  });
  assert.strictEqual(res4, null);

  assert.strictEqual(lastRenderedProps, null);
  console.log("  ✅ Null, undefined, and unregistered kinds handled safely.");
};

const testSuccessfulDispatchAndProps = (): void => {
  lastRenderedProps = null;

  const context: CanvasViewContext = {
    onSendMessage: (msg: string) => console.log(msg),
    onSelectEntity: (id: string) => console.log(id),
    isAgentBusy: true,
  };

  const state: CanvasState<TestAppMap> = {
    content: {
      kind: "card_view",
      title: "Prospect Alpha",
      score: 92,
    },
    activeIntent: {
      action: "HIGHLIGHT",
      targetId: "prospect_alpha",
      targetType: "prospect",
    },
  };

  const element: any = CanvasRenderer({ state, context });
  assert.notStrictEqual(element, null);
  assert.strictEqual(element.type, CardView);
  assert.strictEqual(element.props.data.kind, "card_view");
  assert.strictEqual(element.props.data.title, "Prospect Alpha");
  assert.strictEqual(element.props.data.score, 92);
  assert.strictEqual(element.props.context.isAgentBusy, true);
  assert.strictEqual(element.props.activeIntent?.action, "HIGHLIGHT");

  // Exécution du composant enfant pour vérifier le rendu interne
  const renderedNode = element.type(element.props);
  assert.notStrictEqual(renderedNode, null);
  assert.strictEqual(lastRenderedProps.data.title, "Prospect Alpha");

  console.log("  ✅ O(1) Component Dispatch, VDOM element, and prop propagation validated.");
};

const runAll = (): void => {
  testNullAndUndefinedSafety();
  testSuccessfulDispatchAndProps();
  console.log("🎉 All React Registry tests passed successfully!\n");
};

runAll();

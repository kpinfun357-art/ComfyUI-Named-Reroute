import { app } from "../../scripts/app.js";

const SET_TYPE = "NamedRerouteSet";
const GET_TYPE = "NamedRerouteGet";
const EXTENSION_NAME = "ComfyUI.NamedReroute";

function nodeType(node) {
  return node?.comfyClass || node?.type || node?.constructor?.comfyClass || "";
}

function isSet(node) {
  return nodeType(node) === SET_TYPE;
}

function isGet(node) {
  return nodeType(node) === GET_TYPE;
}

function graphNodes(graph) {
  return graph?._nodes || graph?.nodes || [];
}

function getNode(graph, id) {
  if (typeof graph?.getNodeById === "function") {
    const found = graph.getNodeById(id);
    if (found) return found;
  }
  return graphNodes(graph).find((node) => String(node.id) === String(id)) || null;
}

function getLink(graph, id) {
  const links = graph?.links;
  if (!links || id == null) return null;
  if (Array.isArray(links)) {
    return links.find((link) => link && String(link.id) === String(id)) || null;
  }
  return links[id] || links[String(id)] || null;
}

function getName(node) {
  const widget = node?.widgets?.find((item) => item?.name === "name");
  return String(widget?.value ?? "").trim();
}

function nameKey(name) {
  return String(name ?? "").trim().toLocaleLowerCase();
}

function valueInput(node) {
  return node?.inputs?.find((input) => input?.name === "value") || null;
}

function connectedSource(graph, node) {
  const input = valueInput(node);
  if (!input || input.link == null) return null;
  const link = getLink(graph, input.link);
  if (!link) return null;
  const origin = getNode(graph, link.origin_id);
  if (!origin) return null;
  return { node: origin, slot: Number(link.origin_slot) || 0, link };
}

function outputType(source) {
  return source?.node?.outputs?.[source.slot]?.type ?? "*";
}

function outputName(source) {
  return source?.node?.outputs?.[source.slot]?.name || "value";
}

function hashName(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function hslToHex(h, s, l) {
  const hue = ((h % 360) + 360) % 360 / 360;
  const hue2rgb = (p, q, t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, hue + 1 / 3);
    g = hue2rgb(p, q, hue);
    b = hue2rgb(p, q, hue - 1 / 3);
  }
  const hex = (v) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function tintForName(name) {
  const hash = hashName(name);
  const hue = hash % 360;
  return {
    color: hslToHex(hue, 0.52, 0.43),
    bgcolor: hslToHex(hue, 0.36, 0.19),
  };
}

function buildSetIndex(graph) {
  const byName = new Map();
  for (const node of graphNodes(graph)) {
    if (!isSet(node)) continue;
    const name = getName(node);
    const key = nameKey(name);
    if (!key) continue;
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(node);
  }
  return byName;
}

function resolveSourceForName(graph, setIndex, name, stack = []) {
  const key = nameKey(name);
  if (!key) throw new Error("使用节点的名称不能为空。");
  if (stack.includes(key)) {
    throw new Error(`检测到循环引用：${[...stack, key].join(" → ")}`);
  }
  const matches = setIndex.get(key) || [];
  if (matches.length === 0) throw new Error(`找不到名称为“${name}”的定义节点。`);
  if (matches.length > 1) throw new Error(`名称“${name}”有 ${matches.length} 个定义节点；每个名称只能定义一次。`);
  const source = connectedSource(graph, matches[0]);
  if (!source) throw new Error(`定义节点“${getName(matches[0])}”没有连接输入数据。`);
  if (isSet(source.node)) {
    throw new Error(`定义节点“${getName(matches[0])}”不能直接读取另一个定义节点的输出。`);
  }
  if (isGet(source.node)) {
    return resolveSourceForName(graph, setIndex, getName(source.node), [...stack, key]);
  }
  const out = source.node.outputs?.[source.slot];
  if (!out) throw new Error(`名称“${name}”的来源输出端口不存在。`);
  return { node: source.node, slot: source.slot, output: out };
}

function syncGraph(graph) {
  if (!graph) return;
  const setIndex = buildSetIndex(graph);
  for (const node of graphNodes(graph)) {
    if (!isGet(node)) continue;
    const name = getName(node);
    const color = tintForName(name || "unnamed");
    node.color = color.color;
    node.bgcolor = color.bgcolor;
    const output = node.outputs?.[0];
    if (!output) continue;
    try {
      const source = resolveSourceForName(graph, setIndex, name);
      output.type = source.output.type ?? "*";
      output.name = source.output.name || "value";
      output.label = output.name;
    } catch {
      output.type = "*";
      output.name = "value";
      output.label = "value";
    }
  }
  for (const node of graphNodes(graph)) {
    if (isSet(node) || isGet(node)) {
      const color = tintForName(getName(node) || "unnamed");
      node.color = color.color;
      node.bgcolor = color.bgcolor;
    }
  }
  graph.setDirtyCanvas?.(true, true);
}

function attachNameWidgetCallback(node) {
  const widget = node?.widgets?.find((item) => item?.name === "name");
  if (!widget || widget.__namedRerouteWrapped) return;
  const previous = widget.callback;
  widget.callback = function (...args) {
    const result = previous?.apply(this, args);
    syncGraph(node.graph || app.graph);
    return result;
  };
  widget.__namedRerouteWrapped = true;
}

function installConnectionHooks(nodeTypeDef) {
  const proto = nodeTypeDef?.prototype;
  if (!proto || proto.__namedRerouteWrapped) return;
  const previous = proto.onConnectionsChange;
  proto.onConnectionsChange = function (...args) {
    const result = previous?.apply(this, args);
    syncGraph(this.graph || app.graph);
    return result;
  };
  proto.__namedRerouteWrapped = true;
}

function patchPromptConnections(result, graph) {
  const prompt = result?.output || result?.prompt;
  if (!prompt || typeof prompt !== "object") {
    throw new Error("无法读取 ComfyUI 的执行提示词结构；请更新 ComfyUI 前端后重试。");
  }

  const setIndex = buildSetIndex(graph);
  const virtualIds = new Set();
  const sourceByGetId = new Map();
  for (const node of graphNodes(graph)) {
    if (isSet(node) || isGet(node)) virtualIds.add(String(node.id));
    if (isGet(node)) {
      const name = getName(node);
      const hasOutputLinks = Array.isArray(node.outputs?.[0]?.links) && node.outputs[0].links.length > 0;
      if (hasOutputLinks) {
        if (!name) throw new Error("有使用节点的名称为空，请先填写名称。");
        sourceByGetId.set(String(node.id), resolveSourceForName(graph, setIndex, name));
      }
    }
  }

  // Older ComfyUI prompt builders serialize the virtual nodes as ordinary
  // nodes. Rewrite every API input that points at a Get node, then remove the
  // two virtual node classes from the prompt before it reaches the server.
  for (const nodePrompt of Object.values(prompt)) {
    const inputs = nodePrompt?.inputs;
    if (!inputs || typeof inputs !== "object") continue;
    for (const [inputName, value] of Object.entries(inputs)) {
      if (!Array.isArray(value) || value.length !== 2) continue;
      const source = sourceByGetId.get(String(value[0]));
      if (source) inputs[inputName] = [String(source.node.id), source.slot];
    }
  }
  for (const id of virtualIds) delete prompt[id];
  return result;
}

function notifyError(message) {
  console.error(`[Named Reroute] ${message}`);
  if (typeof window !== "undefined" && typeof window.alert === "function") {
    window.alert(`命名重定向插件：\n\n${message}`);
  }
}

function patchGraphToPrompt() {
  if (app.__namedReroutePatched) return;
  if (typeof app.graphToPrompt !== "function") {
    console.warn("[Named Reroute] app.graphToPrompt 不可用；当前 ComfyUI 前端版本可能不兼容。");
    return;
  }

  const original = app.graphToPrompt;
  app.graphToPrompt = async function (...args) {
    const graph = this.graph || app.graph;
    if (!graph) return original.apply(this, args);

    const hasNamedNodes = graphNodes(graph).some((node) => isSet(node) || isGet(node));
    if (!hasNamedNodes) return original.apply(this, args);

    try {
      const result = await original.apply(this, args);
      return patchPromptConnections(result, graph);
    } catch (error) {
      notifyError(error?.message || String(error));
      throw error;
    }
  };
  app.__namedReroutePatched = true;
}

app.registerExtension({
  name: EXTENSION_NAME,

  beforeRegisterNodeDef(nodeTypeDef, nodeData) {
    if (nodeData?.name === SET_TYPE || nodeData?.name === GET_TYPE) {
      installConnectionHooks(nodeTypeDef);
    }
  },

  nodeCreated(node) {
    if (!isSet(node) && !isGet(node)) return;
    attachNameWidgetCallback(node);
    // nodeCreated can fire before saved links are restored, so sync again next tick.
    setTimeout(() => syncGraph(node.graph || app.graph), 0);
  },

  afterConfigureGraph() {
    syncGraph(app.graph);
  },

  setup() {
    patchGraphToPrompt();
    syncGraph(app.graph);
  },
});

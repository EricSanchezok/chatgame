import type { AlgorithmRef } from "../../engine/algorithms/composition";
import type { WorldInspectorWindow } from "../../shared/world-inspector-api";

function shortHash(value: string): string {
  return value.length <= 16 ? value : `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function nodeSearchText(node: AlgorithmRef, path: string, slot: string): string {
  return `${path} ${slot} ${node.role} ${node.id} ${node.version} ${node.contractVersion} ${JSON.stringify(node.config)}`
    .toLocaleLowerCase();
}

function treeMatches(node: AlgorithmRef, path: string, slot: string, query: string): boolean {
  if (!query || nodeSearchText(node, path, slot).includes(query)) return true;
  return Object.entries(node.children).some(([childSlot, child]) =>
    treeMatches(child, `${path}.${childSlot}`, childSlot, query));
}

function AlgorithmCompositionNode({
  depth,
  node,
  path,
  query,
  slot,
}: {
  depth: number;
  node: AlgorithmRef;
  path: string;
  query: string;
  slot: string;
}) {
  if (!treeMatches(node, path, slot, query)) return null;
  const nodeMatches = !query || nodeSearchText(node, path, slot).includes(query);
  const children = Object.entries(node.children);
  return (
    <li className="cg-algorithm-composition__node">
      <details open={depth < 2 || Boolean(query)}>
        <summary>
          <span className="cg-algorithm-composition__slot">{slot}</span>
          <span className="cg-algorithm-composition__identity">
            <strong>{node.id}@{node.version}</strong>
            <small>{node.role}</small>
          </span>
          <code title={node.manifestHash}>{shortHash(node.manifestHash)}</code>
        </summary>
        <div className="cg-algorithm-composition__body">
          <dl>
            <div><dt>Composition path</dt><dd><code>{path}</code></dd></div>
            <div><dt>Role contract</dt><dd>{node.role} v{node.contractVersion}</dd></div>
            <div><dt>Manifest hash</dt><dd><code>{node.manifestHash}</code></dd></div>
          </dl>
          <details className="cg-algorithm-composition__config">
            <summary>显式配置 · {Object.keys(node.config).length} 项</summary>
            <pre>{JSON.stringify(node.config, null, 2)}</pre>
          </details>
          {children.length > 0 && (
            <ul aria-label={`${node.id} 的子算法`}>
              {children.map(([childSlot, child]) => (
                <AlgorithmCompositionNode
                  depth={depth + 1}
                  key={childSlot}
                  node={child}
                  path={`${path}.${childSlot}`}
                  query={nodeMatches ? "" : query}
                  slot={childSlot}
                />
              ))}
            </ul>
          )}
        </div>
      </details>
    </li>
  );
}

export function WorldInspectorAlgorithmComposition({
  composition,
  query,
}: {
  composition: WorldInspectorWindow["algorithmComposition"];
  query: string;
}) {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const rootMatches = treeMatches(composition.root, "root", "root", normalizedQuery);
  return (
    <section className="cg-algorithm-composition" aria-labelledby="algorithm-composition-title">
      <header className="cg-inspector-collection-header">
        <div>
          <span>PINNED INSTANCE MANIFEST</span>
          <h2 id="algorithm-composition-title">算法 Composition</h2>
          <p>每个路径都是独立可替换的 Role 实现；配置与哈希来自当前实例的不可变快照。</p>
        </div>
        <dl>
          <div><dt>算法节点</dt><dd>{composition.nodeCount}</dd></div>
          <div><dt>根版本</dt><dd>{composition.root.version}</dd></div>
        </dl>
      </header>
      {rootMatches ? (
        <ul className="cg-algorithm-composition__tree" aria-label="当前实例的算法组合树">
          <AlgorithmCompositionNode
            depth={0}
            node={composition.root}
            path="root"
            query={normalizedQuery}
            slot="root"
          />
        </ul>
      ) : (
        <p className="cg-algorithm-composition__empty" role="status">没有匹配的算法、Role、路径或配置。</p>
      )}
    </section>
  );
}

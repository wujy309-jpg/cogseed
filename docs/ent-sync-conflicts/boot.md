
# src/renderer/modules/boot.js

冲突块 3 个   我方 5 行 / 上游 6 行

## 冲突 1  (第 484 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
  const openLegacyAgents = view === 'agents';
```

**上游（开源侧）**
```js
  const openLegacyAgentConnections = view === 'agents';
```


## 冲突 2  (第 501 行起)
   我方 1 行 [中性]
   上游 1 行 [中性]

**我方（企业侧）**
```js
  if (openLegacyAgents) view = 'connections';
```

**上游（开源侧）**
```js
  if (openLegacyAgentConnections) view = 'connections';
```


## 冲突 3  (第 682 行起)
   我方 3 行 [中性]
   上游 4 行 [中性]

**我方（企业侧）**
```js
      if (typeof activateConnectionsTab === 'function') {
        if (openLegacyAgents) activateConnectionsTab('agents');
        else if (view === 'connectors') activateConnectionsTab('mcp');
```

**上游（开源侧）**
```js
      if (openLegacyAgentConnections && typeof activateConnectionsTab === 'function') {
        activateConnectionsTab('agents');
      } else if (view === 'connectors' && typeof activateConnectionsTab === 'function') {
        activateConnectionsTab('mcp');
```



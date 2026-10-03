import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POWERGRYD_SMARTLEAD_CLIENT_ID } from './standards.js';
import {
  DW_GENERIC_WORKSPACE_ID,
  isMixedWorkspace,
  loadWorkspaceClientSeed,
  seedMappedClientIds,
  seedMixedWorkspaceIds,
} from './workspaceClientSeed.js';

test('seed map includes mapped clients, marks DW Generic MIXED, excludes 592842', () => {
  const seed = loadWorkspaceClientSeed();
  assert.equal(seed.excludedSmartleadClientId, POWERGRYD_SMARTLEAD_CLIENT_ID);
  assert.ok(seed.workspaces.every((w) => w.smartleadClientId !== POWERGRYD_SMARTLEAD_CLIENT_ID));

  const mapped = seedMappedClientIds();
  assert.equal(mapped.get('6cabad15-07df-4540-964a-fe93a0965f84'), 345263);
  assert.equal(mapped.get('4ca52711-d8f8-418b-80da-def4c2a62b1e'), 566991);
  assert.equal(mapped.has(DW_GENERIC_WORKSPACE_ID), false);

  const mixed = seedMixedWorkspaceIds();
  assert.equal(mixed.has(DW_GENERIC_WORKSPACE_ID), true);
  assert.equal(isMixedWorkspace(DW_GENERIC_WORKSPACE_ID, 'DW Generic Pool'), true);
  assert.equal(isMixedWorkspace('other', 'SalesGlider'), false);
});

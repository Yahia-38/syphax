import assert from 'node:assert/strict';
import test from 'node:test';
import { isMainNavigationLinkActive } from '../lib/main-navigation.js';

test('le tableau de bord n’est actif que sur la racine', () => {
  assert.equal(isMainNavigationLinkActive('/', '/'), true);
  for (const pathname of ['/produits', '/livreurs/6aa73924f609544f68c37666', '/caisse']) {
    assert.equal(isMainNavigationLinkActive(pathname, '/'), false);
  }
});

test('une entrée reste active sur ses pages de détail', () => {
  assert.equal(isMainNavigationLinkActive('/livreurs', '/livreurs'), true);
  assert.equal(isMainNavigationLinkActive('/livreurs/6aa73924f609544f68c37666', '/livreurs'), true);
  assert.equal(isMainNavigationLinkActive('/livreurs/nouveau', '/livreurs'), true);
  assert.equal(isMainNavigationLinkActive('/produits/6aa87bf1a6c1118e767192f0/modifier', '/produits'), true);
});

test('un préfixe partiel n’active pas l’entrée voisine', () => {
  assert.equal(isMainNavigationLinkActive('/livreurs-archives', '/livreurs'), false);
  assert.equal(isMainNavigationLinkActive('/receptions', '/rentabilite'), false);
  assert.equal(isMainNavigationLinkActive('/tournees/6aa87bf1a6c1118e767192f0', '/livreurs'), false);
});

test('un chemin indisponible ne rend aucune entrée active', () => {
  assert.equal(isMainNavigationLinkActive(null, '/produits'), false);
  assert.equal(isMainNavigationLinkActive(undefined, '/'), false);
});

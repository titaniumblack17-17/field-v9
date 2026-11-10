import { test } from 'node:test'
import assert from 'node:assert/strict'
import { jugerReponse, TABLES_PROTEGEES } from './verifier-rls.mjs'

test('[] = fermée', () => assert.equal(jugerReponse(200, '[]').ferme, true))
test('une ligne lisible = ouverte (échec)', () => assert.equal(jugerReponse(200, '[{"id":"x"}]').ferme, false))
test('401/403 = fermée', () => {
  assert.equal(jugerReponse(401, '{"message":"Invalid API key"}').ferme, true)
  assert.equal(jugerReponse(403, '{"code":"42501","message":"permission denied"}').ferme, true)
})
test('42501 en 4xx = fermée', () => assert.equal(jugerReponse(400, '{"code":"42501","message":"denied"}').ferme, true))
test('corps illisible ou 5xx = à examiner (non fermée)', () => {
  assert.equal(jugerReponse(502, 'bad gateway').ferme, false)
  assert.equal(jugerReponse(200, '<html>').ferme, false)
})
test('liste des tables : 18, sans doublon', () => {
  assert.equal(TABLES_PROTEGEES.length, 18)
  assert.equal(new Set(TABLES_PROTEGEES).size, 18)
})

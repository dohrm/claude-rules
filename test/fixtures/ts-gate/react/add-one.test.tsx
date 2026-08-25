import { expect, test } from 'vitest'
import { addOne } from './add-one'

test('increments', () => {
  expect(addOne(1)).toBe(2)
})

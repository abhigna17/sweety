import test from 'node:test';
import assert from 'node:assert/strict';
import { readingSchema } from '../src/validators.js';
const base={date:'2026-11-09',slot:'MORNING'};
test('accepts valid whole-number glucose readings',()=>{for(const value of [40,85,600])assert.equal(readingSchema.safeParse({...base,value}).success,true);});
test('rejects a missing glucose value with a clear message',()=>{const result=readingSchema.safeParse({...base,value:''});assert.equal(result.success,false);assert.equal(result.error.issues[0].message,'Please enter a glucose value.');});
test('rejects values outside 40–600 mg/dl',()=>{for(const value of [39,601]){const result=readingSchema.safeParse({...base,value});assert.equal(result.success,false);assert.equal(result.error.issues[0].message,'Value must be between 40 and 600 mg/dl.');}});
test('rejects decimal glucose readings',()=>{const result=readingSchema.safeParse({...base,value:85.5});assert.equal(result.success,false);assert.equal(result.error.issues[0].message,'Value must be between 40 and 600 mg/dl.');});

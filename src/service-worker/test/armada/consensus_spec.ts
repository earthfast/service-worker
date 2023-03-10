import {Hashable, majorityResult} from '../../src/armada/consensus';

class HashableObject {
  constructor(public obj: Object) {}

  public hash(): string {
    return JSON.stringify(this.obj);
  }
}

describe('Consensus', () => {
  describe('majorityResult', () => {
    describe('succeeds', () => {
      const cases: {
        name: string,
        input: (string|Hashable)[],
        want: string|Hashable,
      }[] =
          [
            {
              name: 'when there is only 1 input',
              input: [
                'a',
              ],
              want: 'a',
            },
            {
              name: 'when 2 inputs agree',
              input: [
                'b',
                'b',
              ],
              want: 'b',
            },
            {
              name: 'when an odd number of inputs agree',
              input: [
                'a',
                'a',
                'a',
              ],
              want: 'a',
            },
            {
              name: 'when an even number of inputs agree',
              input: [
                'b',
                'b',
                'b',
                'b',
              ],
              want: 'b',
            },
            {
              name: 'when a majority of an odd number of inputs agree',
              input: [
                'a',
                'a',
                'b',
                'b',
                'b',
              ],
              want: 'b',
            },
            {
              name: 'when a majority of an even number of inputs agree',
              input: [
                'a',
                'a',
                'b',
                'b',
                'b',
                'b',
              ],
              want: 'b',
            },
            {
              name: 'when Hashables are provided',
              input: [
                new HashableObject({name: 'a'}),
                new HashableObject({name: 'b'}),
                new HashableObject({name: 'b'}),
              ],
              want: new HashableObject({name: 'b'}),
            },
          ];

      for (let tc of cases) {
        it(tc.name, async () => {
          const promises = tc.input.map(val => Promise.resolve(val));
          expect(await majorityResult(promises)).toEqual(tc.want);
        });
      }
    });

    describe('rejects', () => {
      const cases: {
        name: string,
        input: (string|Hashable|Error)[],
        wantErrorPattern: RegExp,
      }[] =
          [
            {
              name: 'when there is only 1 input and it fails',
              input: [
                new Error('fail'),
              ],
              wantErrorPattern: /errorCount=1/,
            },
            {
              name: 'when 2 inputs disagree',
              input: [
                'a',
                'b',
              ],
              wantErrorPattern: /uniqueValues=2/,
            },
            {
              name: 'when 1 of 2 inputs fails',
              input: [
                'a',
                new Error('fail'),
              ],
              wantErrorPattern: /errorCount=1 uniqueValues=1/,
            },
            {
              name: 'when an odd number of inputs disagree',
              input: [
                'a',
                'b',
                'c',
              ],
              wantErrorPattern: /uniqueValues=3/,
            },
            {
              name: 'when an even number of inputs disagree',
              input: [
                'a',
                'a',
                'b',
                'c',
              ],
              wantErrorPattern: /uniqueValues=3/,
            },
            {
              name: 'when only a minority of an odd number of inputs agree',
              input: [
                'a',
                'a',
                'b',
                'b',
                'c',
              ],
              wantErrorPattern: /uniqueValues=3/,
            },
            {
              name: 'when only a minority of an even number of inputs agree',
              input: [
                'a',
                'a',
                'a',
                'b',
                'b',
                'b',
              ],
              wantErrorPattern: /uniqueValues=2/,
            },
            {
              name: 'when there is exactly 50% agreement due to failures',
              input: [
                'a',
                'b',
                new Error('fail'),
                'a',
                'b',
              ],
              wantErrorPattern: /errorCount=1 uniqueValues=2/,
            },
            {
              name: 'as soon as no majority candidates exist',
              input: [
                'a',
                'b',
                'c',
                'd',
                // Should short-circut here
                'e',
              ],
              wantErrorPattern: /uniqueValues=4/,
            },
          ];

      for (let tc of cases) {
        it(tc.name, async () => {
          let rejectFunctions: (() => void)[] = [];
          const promises: Promise<string|Hashable>[] = tc.input.map(val => {
            if (val instanceof Error) {
              return new Promise((resolve, reject) => {
                rejectFunctions.push(() => {
                  reject(val);
                });
              });
            }
            return Promise.resolve(val);
          });

          const got = majorityResult(promises);
          rejectFunctions.forEach(fn => fn());
          await expectAsync(got).toBeRejectedWithError(tc.wantErrorPattern);
        });
      }
    });
  });
});
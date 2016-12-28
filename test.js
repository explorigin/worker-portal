import test from 'ava';

import { WorkerPortal } from './lib';


function FakeWorkerPair() {
    let cbA = null;
    let cbB = null;

    const objA = {
        postMessage: (data) => {
            cbB({ data: data });
        },
        addEventListener: (eventName, fn) => {
            cbA = (...r) => { fn(...r); };
        },
        removeEventListener: (eventName, fn) => {
            cbA = null;
        }
    };

    const objB = {
        postMessage: (data) => {
            cbA({ data: data });
        },
        addEventListener: (eventName, fn) => {
            cbB = (...r) => { fn(...r); };
        },
        removeEventListener: (eventName, fn) => {
            cbB = null;
        }
    };

    return [objA, objB];
}

test('Workers can call and respond equally', async t => {
    const [a, b] = FakeWorkerPair();

    const slave = WorkerPortal(
        {
            slaveAdd: (a, b) => (a + b),
            math: {
                multiply: (a, b) => (a * b),
                lib: {
                    pow: (a, b) => Math.pow(a, b),
                }
            }
        },
        a,
        true
    );
    const master = WorkerPortal(
        {
            masterSubtract: (a, b) => (a - b)
        },
        b,
        false
    );

    const masterApi = await master;
    const slaveApi = await slave;

    t.deepEqual(Object.keys(masterApi), ['__init', '__cleanupSlave', 'slaveAdd', 'math', '_cleanup']);
    t.deepEqual(Object.keys(masterApi.math), ['multiply', 'lib']);
    t.deepEqual(Object.keys(slaveApi), ['masterSubtract']);

    t.is(await slaveApi.masterSubtract(9, 2), 7);
    t.is(await masterApi.slaveAdd(9, 2), 11);
    t.is(await masterApi.math.multiply(9, 2), 18);
    t.is(await masterApi.math.lib.pow(9, 2), 81);

    t.is(await masterApi.slaveAdd(5, 2), 7);
    t.is(await slaveApi.masterSubtract(2, 2), 0);

    await masterApi._cleanup();

    return masterApi.slaveAdd(9, 2)
        .then(e => {
            t.fail('Expected rejection');
        })
        .catch(e => {
            t.is(e.message, 'Portal disabled');
        });
});

// Copyright (c) 2016 Timothy Farrell
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.


function tryJSON(type, destination, id, data) {
    const packet = [type, destination, id, data];
    try {
        return JSON.stringify(packet);
    } catch (e) {
        return packet;
    }
}

export function WorkerPortal(context, worker, isSlave, serialize) {
    const responseMap = new Map();
    const _worker = worker || self;
    const contextIndex = Object.keys(context);
    const _serialize = (
        serialize
        ? (type, destination, id, params) => serialize(type, destination, id, params, tryJSON)
        : tryJSON
    );
    let callCount = 0;
    let enabled = false;

    function post(type, id, destination, params) {
        _worker.postMessage(_serialize(type, destination, id, params));
    }

    function dispatcher(evt) {
        let data;
        try {
            data = JSON.parse(evt.data);
        } catch (e) {
            data = evt.data;
        }
        const destination = data[1];
        const id = data[2];
        const params = data[3];

        function _resolve(value) {
            post(1, id, 0, value);
        }
        function _reject(e) {
            post(1, id, 1, { message: e.message, name: e.name, stack: e.stack });
        }

        // If we have received an RPC response, satisfy the promise.
        if (data[0]) {
            if (responseMap.has(id)) {
                const responses = responseMap.get(id);
                responseMap.delete(id);
                responses[destination](params);
            }
            return;
        }

        // If we have received an RPC call, execute and respond.
        let thennable;
        try {
            thennable = context[contextIndex[destination]].apply(null, params);
        } catch (e) {
            _reject(e);
        }
        if (thennable && typeof thennable.then === 'function') {
            thennable.then(_resolve).catch(_reject);
        } else {
            _resolve(thennable);
        }
    }

    function injectionPointFactory(fnId, callbackFactory) {
        return function(...args) {
            return new Promise((resolve, reject) => {
                if (!enabled && fnId !== 0) {
                    reject(new Error('Portal disabled'));
                }
                const id = callCount;
                callCount += 1;
                responseMap.set(
                    id,
                    [
                        callbackFactory ? callbackFactory(resolve) : resolve,
                        reject
                    ]
                );
                post(0, id, fnId, args);
            });
        };
    }

    function resolveExternalInterfaceFactory(resolve) {
        return (linkedFunctionNames, ...rest) => {
            const externalInterface = {};
            linkedFunctionNames.forEach((fnName, index) => {
                externalInterface[fnName] = injectionPointFactory(index);
            });
            enabled = true;
            resolve(externalInterface);
            return contextIndex;
        };
    }

    function cleanup() {
        enabled = false;
        _worker.removeEventListener('message', dispatcher);
        for (let key of responseMap.keys()) {
            try {
                responseMap.get(key)[1](new Error('Portal cleanup called.'));
            } catch (e) {}
        }
    }

    _worker.addEventListener('message', dispatcher);

    if (isSlave) {
        return new Promise(resolve => {
            contextIndex.splice(0, 0, '__init', '__cleanupSlave');
            context.__init = resolveExternalInterfaceFactory(resolve);
            context.__cleanupSlave = cleanup;
        });
    }

    return injectionPointFactory(0, resolveExternalInterfaceFactory)(contextIndex)
        .then(api => Object.assign(api, {
            _cleanup: injectionPointFactory(1, resolve => resolve(cleanup())),
        }));
}

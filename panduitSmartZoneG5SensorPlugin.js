const fs = require('fs');
const path = require('path');

var _axios = null;
const _sensorMul = {
    "RH": 1,
    "T": 0.1,
    "I": 0.001
}
const _exact = {
    "I": 0.1,
    "T": 0.1,
    "RH": 1
}

const sensors = [
    {
        //.1 genauigkeit
        "sensor": "T",
        "lable": "T",
        "scale": "°C"
    },
    {
        "sensor": "RH",
        "lable": "H",
        "scale": "%"
    },
    [
        //.1 genauigkeit
        //L1.1+L1.2, L2.1+L2.2, L3.1+L3.2
        {
            "sensor": "L1.1",
            "lable": "L1",
            "scale": "A"
        },
        /*{
            "sensor": "L2.1",
            "lable": "L2",
            "scale": "A"
        },
        {
            "sensor": "L3.1",
            "lable": "L3",
            "scale": "A"
        }*/
    ],
    /*[
        //.1 genauigkeit
        //L1.1+L1.2, L2.1+L2.2, L3.1+L3.2
        {
            "sensor": "L1.2",
            "lable": "12",
            "scale": "A"
        },
        {
            "sensor": "L2.2",
            "lable": "22",
            "scale": "A"
        },
        {
            "sensor": "L3.2",
            "lable": "32",
            "scale": "A"
        }
    ]*/
]

const _baseConfig = {
    cred: { username: "", password: "" },
    proto: "https",
    hostSuffix: "",
    mapping: { offset: 2 },
    cookiePath: "panduitSmartZoneG5SensorPlugin.cookies.json"
};

function _storeCookie(pdu) {
    _getConfig().then(conf => {
        fs.readFile(path.join(__dirname, conf.cookiePath), (err, data) => {
            let cookies = { cookies: {} };
            if (!err) {
                cookies = JSON.parse(data.toString());
            }
            cookies.cookies[pdu.url] = pdu.cookie;
            fs.writeFile(path.join(__dirname, conf.cookiePath), JSON.stringify(cookies), (err) => {
                if (err) {
                    console.error("Store Cookie", err);
                }
            });
        });
    })
}

function _getCookie(pdu) {
    return new Promise((accept) => {
        _getConfig().then(conf => {
            fs.readFile(path.join(__dirname, conf.cookiePath), (err, data) => {
                if (!err) {
                    let cookies = JSON.parse(data.toString());
                    try {
                        pdu.cookie = cookies.cookies[pdu.url];
                    } catch (e) { }
                }
                accept(pdu);
            });
        });
    });
}

function _fillPDU(conf, lock) {
    return new Promise(accept => {
        let pdu = {}
        pdu.cred = conf.cred;
        pdu.proto = conf.proto;
        pdu.hostSuffix = conf.hostSuffix;

        let ipSegs = lock.ip.split(".");
        ipSegs[3] = parseInt(ipSegs[3]) + conf.mapping.offset;
        pdu.host = ipSegs.join(".");

        if (conf.mapping[lock.ip] != undefined) {
            let mapping = conf.mapping[lock.ip];
            if (mapping.host != undefined) {
                pdu.host = mapping.host;
            }
            if (mapping.cred != undefined) {
                pdu.cred = mapping.cred;
            }
            if (mapping.proto != undefined) {
                pdu.proto = mapping.proto;
            }
            if (mapping.hostSuffix != undefined) {
                pdu.hostSuffix = mapping.hostSuffix;
            }
        }

        pdu.url = `${pdu.proto}://${pdu.host}${pdu.hostSuffix}`;

        _getCookie(pdu).then(pdu => {
            accept(pdu);
        });
    });
}

function _auth(pdu) {
    return new Promise((resolve, reject) => {
        _axios.post(`${pdu.url}/xhrlogin.jsp`, json = { cookie: 0, username: pdu.cred.username, password: pdu.cred.password })
            .then(res => {
                console.log("Done LOGIN", pdu);
                pdu.cookie = res.data.cookie;
                _storeCookie(pdu);
                resolve(pdu);
            })
            .catch(err => {
                console.error(err);
                reject(err);
            })
    });
}

function _getConfig() {
    return new Promise((resolve, reject) => {
        fs.readFile(path.join(__dirname, "panduitSmartZoneG5SensorPlugin.json"), (err, data) => {
            if (err) {
                //console.warn("[WARN] Panduit SensorPlugin FetchConfig", err);
                resolve(_baseConfig);
            } else {
                resolve(JSON.parse(data.toString()));
            }
        });
    });
}

function _getSensors(lock) {
    return new Promise(resolve => {
        _getConfig()
            .then(conf => {
                var responseSensors = JSON.parse(JSON.stringify(sensors));
                //let pdu = conf.mapping[lock.ip];
                _fillPDU(conf, lock).then(pdu => {
                    if (!pdu) {
                        _fillAllWithText(responseSensors, "NoMapping");
                        resolve(responseSensors);
                        return;
                    }
                    _fetchExtSensors(pdu, ["T", "RH"])
                        .then(([pdu, extSensors]) => {
                            responseSensors[0].value = extSensors[0];
                            responseSensors[1].value = extSensors[1];
                            _fetchAmps(pdu)
                                .then((amps) => {
                                    let i = 0;
                                    responseSensors[2].forEach(amp => {
                                        amp.value = amps[i++];
                                    });
                                    if (responseSensors.length == 4) //Has Dual CB
                                        responseSensors[3].forEach(amp => {
                                            amp.value = amps[i++];
                                        });
                                    resolve(responseSensors)
                                })
                                .catch(err => {
                                    console.error("ErrorAmps", err);
                                    responseSensors[2].forEach(amp => {
                                        amp.value = "ErrFetch";
                                    })
                                    responseSensors[3].forEach(amp => {
                                        amp.value = "ErrFetch";
                                    })
                                    resolve(responseSensors);
                                })
                        })
                        .catch(err => {
                            _fillAllWithText(responseSensors, err);
                            resolve(responseSensors);
                        });
                });
            })
            .catch(err => {
                console.error(err);
                let responseSensors = JSON.parse(JSON.stringify(sensors));
                _fillAllWithText(responseSensors, "Error Loading Conf")
                resolve(responseSensors);
            });
    });
}
function _fillAllWithText(sensors, text) {
    sensors.forEach(s => {
        if (Array.isArray(s)) {
            s.forEach(sg => sg.value = text);
        } else {
            s.value = text;
        }
    });
}

function _fetchExtSensors(pdu, sensors, retry = 0) {
    return new Promise((resolve, reject) => {
        _axios.post(`${pdu.url}/sensors_get`, json = { cookie: pdu.cookie })
            .then(res => {
                let vals = [];
                res.data[0].forEach(s => {
                    let val = s.reading;
                    val *= _sensorMul[s.name];
                    val = Math.round(val / _exact[s.name]) * _exact[s.name];
                    vals[sensors.indexOf(s.name)] = val;
                });
                resolve([pdu, vals]);
            })
            .catch(err => {
                if (retry == 0 && err.response && err.response.status && err.response.status == 401) {
                    _auth(pdu)
                        .then(pdu => {
                            console.log("DONE AUTH")
                            _fetchExtSensors(pdu, sensors, 1)
                                .then(([pdu, vals]) => resolve([pdu, vals]));
                        })
                        .catch(err => {
                            console.error("PDU Auth", err);
                            reject("ErrAuth");
                        });
                } else {
                    console.error("ExtSensErr");
                    reject("ErrExtSens");
                }
            })
    });
};

function _fetchAmps(pdu) {
    return new Promise((resolve, reject) => {
        _axios.post(`${pdu.url}/load_segment_detail`, json = { cookie: pdu.cookie })
            .then(res => {
                let amps = res.data.map(cv => {
                    let i = cv.cur;
                    i *= _sensorMul['I'];
                    i = Math.round(i / _exact["I"]) * _exact["I"];
                    return i;
                });
                resolve(amps);
            })
            .catch(err => {
                reject(err);
            });
    });
};

module.exports = {
    name: () => "panduitSmartZoneG5SensorPlugin",

    init: (config) => {
        _axios = config.axios;
    },


    availSensors: () => {
        return sensors;
    },

    getSensors: _getSensors,

    getConfig: () => {
        return new Promise(accept => {
            _getConfig().then(conf => {
                accept(conf);
            }).catch(e => {
                accept(_baseConfig);
            });
        });
    },

    writeConfig: (config) => {
        fs.writeFile(path.join(__dirname, "panduitSmartZoneG5SensorPlugin.json"), JSON.stringify(config), (err) => {
            if (err) {
                console.error("Store Config", err);
            }
        });
    },

    getHelp: () => {
        return '\
{\n\
    "cred": {\n\
        "username": "", //globalPanduit UserName\n\
        "password": ""  //globalPanduit Password\n\
    },\n\
    proto: "https", //ConnectionProtocol\n\
    hostSuffix: "", //Suffix after host of URL (eg ":8443")\n\
    "mapping": {\n\
        "offset": 2  //lockIP Offset (eg 192.168.0.90 + 2 = 192.168.0.92)\n\
        "192.168.0.90":{ //optional manual Mapping for 192.168.0.90\n\
            //the overwrite can contain all previous "baseSettings" (cred, proto, hostSuffix)\n\
            "cred": { //manual User Overwrite for 192.168.0.90\n\
                "username": "", //globalPanduit UserName\n\
                "password": ""  //globalPanduit Password\n\
            }\n\
            host: "192.168.2.90 //Manual Host overwrite for 192.168.0.90\n\
        }\n\
    },\n\
    "cookiePath": "panduitSmartZoneG5SensorPlugin.cookies.json" //defaultCookieStoreFile\n\
}';
    }
}

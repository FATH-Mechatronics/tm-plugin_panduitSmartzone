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
        {
            "sensor": "L2.1",
            "lable": "L2",
            "scale": "A"
        },
        {
            "sensor": "L3.1",
            "lable": "L3",
            "scale": "A"
        }
    ],
    [
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
    ]
]

function _storeCookie(pdu) {
    fs.readFile(path.join(__dirname, "panduitSmartZoneG5SensorPlugin.json"), (err, data) => {
        let config = JSON.parse(data.toString());
        config.cookies[pdu.url] = pdu.cookie;
        fs.writeFile(path.join(__dirname, "panduitSmartZoneG5SensorPlugin.json"), JSON.stringify(config), (err) => {
            if (err) {
                console.error("Store Cookie", err);
            }
        });
    });
}

function _auth(pdu) {
    return new Promise((resolve, reject) => {
        _axios.post(`${pdu.url}/xhrlogin.jsp`, json = { cookie: 0, username: pdu.username, password: pdu.password })
            .then(res => {
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
    return new Promise(resolve => {
        fs.readFile(path.join(__dirname, "panduitSmartZoneG5SensorPlugin.json"), (err, data) => {
            if (err) {
                reject(err);
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
                let pdu = conf.mapping[lock.ip];
                if (!pdu) {
                    _fillAllWithText(responseSensors, "NoMapping");
                    resolve(responseSensors);
                    return;
                }
                pdu.cookie = conf.cookies[pdu.url];
                _fetchExtSensors(pdu, ["T", "RH"])
                    .then(([pdu, extSensors]) => {
                        responseSensors[0].value = extSensors[0];
                        responseSensors[1].value = extSensors[1];
                        _fetchAmps(pdu)
                            .then((amps) => {
                                let i = 0;
                                responseSensors[2].forEach(amp => {
                                    amp.value = amps[i++];
                                })
                                responseSensors[3].forEach(amp => {
                                    amp.value = amps[i++];
                                })
                                resolve(responseSensors)
                            })
                            .catch(err => {
                                console.error("ErrorAmps",err);
                                responseSensors[2].forEach(amp => {
                                    amp.value = "ErrFetch";
                                })
                                responseSensors[3].forEach(amp => {
                                    amp.value = "ErrFetch";
                                })
                                resolve(responseSensors);
                            })
                    })
                    .catch(err=>{
                        _fillAllWithText(responseSensors,err);
                        resolve(responseSensors);
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
                            _fetchExtSensors(pdu, sensors, 1)
                                .then(([pdu, vals]) => resolve([pdu, vals]));
                        })
                        .catch(err => {
                            reject("ErrAuth");
                        });
                } else {
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
    init: (config) => {
        _axios = config.axios;
    },


    availSensors: () => {
        return sensors;
    },

    getSensors: _getSensors,
}

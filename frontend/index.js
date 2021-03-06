var byline = require("byline");
var fs = require('fs');
var repl = require("repl");
var yargs = require("yargs");

var log = require("./log.js");
var serial = require("./serial_communication.js");
// global singleton func that sets and determines the current state of the
// arduino board
var state = require("./printer_state.js");

var REPL_STARTED = false;
var PRINT_STARTED = false;
var STREAM;


function parse_line(gcode_str) {
  /* Parse a string of GCode into an object */
  var GCode = {};
  GCode.raw = gcode_str;
  var l = gcode_str.split(';');  // [gcode, comment]
  if (l[1]) {  // log comments in gcode
    GCode.comment = l[1];
    log.gcode("comment: " + GCode.comment);
  }
  if (l[0]) {
    var _gcode = l[0].split(/\s+/);
    GCode.instruction = _gcode.shift();  // G0 G1 M100 etc

    var regexp = /([A-z]+)(\-?[0-9]+)/
    _gcode.forEach(function(code) {
      var m = regexp.exec(code);
      GCode[m[1]] = parseInt(m[2], 10);
    });
    log.gcode(JSON.stringify(GCode));
  } else {
    GCode.skip = true;
  }
  return GCode
}


function send_serial(fp) {
  /*
   * 1. open gcode file
   * 2. for line in file, convert to printer instructions
   * 3. send to printer
   *
   * -- if unrecognized instruction, raise warning
   */
  if (STREAM) {
    log.warn("resuming gcode transmission");
  } else {
    log("starting gcode transmission")
    STREAM = fs.createReadStream(fp);
    STREAM = byline.createStream(STREAM);
    // STREAM = byline(fs.createReadStream(fp));
    STREAM.on('end', function() {
      serial.send("end of gcode transmission");
      serial.close_connection();
    });
  }
  STREAM.on('readable', function() {
    var line;
    while (null !== (line = STREAM.read())) {
      var gcode = parse_line(line.toString());
      if (!gcode.skip) {
        msg = serial.msg_pack(gcode);
        serial.send(msg);
      }
    }
  });
}


function main(argv) {
  serial.open_connection(argv.serialport, argv.baudrate);
  state.on('all_on', function() {
    if (argv.fp == "repl") {
      if (!REPL_STARTED) {
        log("Attaching repl for interactive use");
        var rs = repl.start("repl> ").on('exit', function() {
          log("EXIT");
          process.exit();
        });
        REPL_STARTED = true;
      }
    } else if (!PRINT_STARTED) {
      log("Starting print");
      PRINT_STARTED = true;
      send_serial(argv.fp);
    } else {
      log("Arduino reset while print in progress.  Will hopefully recover.");
    }
  });
}

function parse_argv() {
  return yargs
  .options('f', {
    alias: 'fp',
    required: true,
    describe: "filepath to a gcode file.  "
    + " ie: --fp ./myprint.gcode   ..."
    + " if you pass --fp repl, load a repl instead.",
  })
  .options('p', {
    alias: 'serialport',
    required: false,  // handled in main
    describe: "device path to arduino serial port."
    + " ie: --sp /dev/ttyACM0",
  })
  .options('m', {
    alias: 'microstepping',
    default: 32
  })
  .options('b', {
    alias: 'baudrate',
    default: 9600
  })
  .strict()
  .argv;
}

// execute main function
main(parse_argv());

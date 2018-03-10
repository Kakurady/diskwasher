const blessed = require('blessed');

class ThottledUpdater{
    
    /*

    1. start fast after there's a change
    2. once an update is drawn, buffer further changes for one frame time and then update.

    incoming |  |  |  
    dirty    -  -- ---
    pending  =============
    outgoing  |   |   |   |
    */

    constructor(options){
        this._fnUpdateNow = options.fnUpdateNow || (fn => setImmediate(fn));
        this._fnUpdateDelayed = options.fnUpdateDelayed || (fn => setTimeout(fn, 16));
        this.dirty = false; // if false, stop repeating
        this.pending = false; // if true, stop scheduling
    }

    onChange(){
        let self = this;

        if(!this.pending){
            this.pending = true;
            this._fnUpdateNow(function (){
                self.checkAndDoUpdate();
            });

        }
        this.dirty = true;
    }

    checkAndDoUpdate(){
        let self = this;

        if (!this.dirty) {
            this.pending = false;
            return;
        } else {
            this.dirty = false;
            this.doUpdate();
            this._fnUpdateDelayed(function() {
                self.checkAndDoUpdate();
            });
        }
    }

    afterUpdate(){

    }
}

class ConsoleUI extends ThottledUpdater {
    constructor(){
        super({fnUpdateDelayed: (fn => setTimeout(fn, 16)) });

        this.screen = blessed.screen({
            smartCSR: true, 
            fullUnicode: true,
            autoPadding: true
        });

        this.box = blessed.box({
            top:"center",
            left: "center",
            height: "shrink",
            border: {type:"line"},
            padding: 1,
            style: {
                fg: "white",
                bg: "black",
                border:{
                    fg: "white"
                }
            }
        });

        this.line = blessed.text({
            top: 0,
            left: 0,
            height: 1,
            content: "test",
        });
        this.progressBar = blessed.progressbar({
            top: 2,
            left: 0,
            width: "100%-4",
            height: 1,
            style: {
                fg: "red",
                bg: "green"
            }
        });
        this.box.append(this.line);
        this.box.append(this.progressBar);

        this.screen.append (this.box);

        this.screen.render();
    }



    onChange(obj){

        this.state = obj;
        super.onChange();
    }

    doUpdate(){

        // TODO: if displaying megabytes, display the current file name so small files don't look it's stuck.

        let total = this.state.total;
        let totalMax = this.state.totalMax;

        this.progressBar.setProgress(Math.floor(total/totalMax*100));
        this.line.content = `${total} / ${totalMax}`;
        this.screen.render();

    }

    destroy(){
        this.screen.destroy();
    }
}

module.exports = ConsoleUI;
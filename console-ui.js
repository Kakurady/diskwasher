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
        super({fnUpdateDelayed: (fn => setTimeout(fn, 1000)) });
    }

    onChange(obj){

        this.state = obj;
        super.onChange();
    }

    doUpdate(){

        // TODO: if displaying megabytes, display the current file name so small files don't look it's stuck.

        let total = this.state.total;
        let totalMax = this.state.totalMax;

        console.log(`${total} / ${totalMax}`);
    }

}

module.exports = ConsoleUI;
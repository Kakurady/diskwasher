import blessed from 'blessed';

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

        // FIXME use Symbol to hide this or maybe a better name
        this._finishedPromise = new Promise((resolve, reject)=>{
            try {
                this.screen.on("destroy",()=>{
                    resolve();
                })
            } catch (ex){
                reject(ex);
            }
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


    finish(){
        return this._finishedPromise;
    }

    onChange(obj){

        this.state = obj;
        super.onChange();
    }

    doUpdate(){

        // TODO: if displaying megabytes, display the current file name so small files don't look it's stuck.
        let state = (typeof this.state.getState == 'function') && this.state.getState() || this.state;
        let total = state.total;
        let totalMax = state.totalMax;
        let currentItem = state.currentItem || ""

        this.progressBar.setProgress(Math.floor(total/totalMax*100));
        this.line.content = `${total} / ${totalMax} ${currentItem}`;
        this.screen.render();

    }

    /**
     * 
     * @param {DWDirInfo[]} dirInfos 
     */
    showDuplicates(dirInfos){
        let items = [];
        items = flatMap(
            dirInfos, 
            dirInfo => flatMap(
                [...dirInfo.dupsByDigest], 
                x=>[x, ...dirInfo.digestIndex.get(x)]
            ));

        this.list = blessed.list({
            top: "0",
            left: "0",
            height: "100%",
            width: "100%",
            scrollable: true,
            keys: true,
            mouse: true,
            //alwaysScroll: true,
            scrollbar:{
                ch: ' ',
                bg: "yellow"
            },
            interactive: true,
            invertSelected: true,
            style: {
                fg: "white",
                bg: "black",
                border:{
                    fg: "white"
                },
                item:              
                { fg: "white",
                bg: "black"},

                selected:                 { fg: "white",
                bg: "blue"}
            },
            items: items
        });
        this.screen.append(this.list);
        this.screen.render();

        this.screen.key('q', function() {
            return this.destroy();
        });
          
    }

    filesNotBackedUpToFlatArray(filesArrayOfArray){
        let indicator = (x) => x.exactMatch? "x": x.similarMatches? "-": " ";

        return flatMap(
            filesArrayOfArray, 
            files => files.map(x=>`${indicator(x)} ${x.file.relpath}`)
        );
    }
/**
     * 
     * @param {DWDirInfo[][]} dirInfos 
     */
    showFilesNotBackedUp(filesArrayOfArray){
        let items = this.filesNotBackedUpToFlatArray(filesArrayOfArray);

        this.list = blessed.list({
            top: "0",
            left: "0",
            height: "100%",
            width: "100%",
            scrollable: true,
            keys: true,
            mouse: true,
            //alwaysScroll: true,
            scrollbar:{
                ch: ' ',
                bg: "yellow"
            },
            interactive: true,
            invertSelected: true,
            style: {
                fg: "white",
                bg: "black",
                border:{
                    fg: "white"
                },
                item:              
                { fg: "white",
                bg: "black"},

                selected:                 { fg: "white",
                bg: "blue"}
            },
            items: items
        });
        this.screen.append(this.list);
        this.screen.render();

        this.screen.key('q', function() {
            return this.destroy();
        });
          
    }
    destroy(){
        this.screen.destroy();
    }
}

function _flatMap(arr, func){
    let acc = [];
    let res = arr.map(func);
    for (const item of res){
        for (const x of item){
            acc.push(x);
        }
    }
    return acc;
}
function flatMap(arr, func){
    return arr.flatMap && arr.flatMap(func) || _flatMap(arr, func);
}

export { ConsoleUI as default };
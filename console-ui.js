const blessed = require('blessed');
const byteSize = require('byte-size');
const os_platform = require('os').platform;
const open = require('opn');
const path = require('path');

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
        
        let { items, itemIndices } = this.buildDuplicateList(dirInfos);
        let selectedItemLine = blessed.text({
            bottom: 0,
            left: 0,
            height: 1,
            content: "test",
        });
        this.selectedItemLine = selectedItemLine;
        this.list = blessed.list({
            top: "0",
            left: "0",
            height: "100%-1",
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
        let contextMenu = blessed.list({
            top: "center",
            left: "center",
            height: "shrink",
            border: { type: "line" },
            padding: 1,
            keys: true,
            mouse: true,
            // scrollbar:{
            //     ch: ' ',
            //     bg: "yellow"
            // },
            interactive: true,
            invertSelected: true,
            style: {
                fg: "white",
                bg: "black",
                border: {
                    fg: "white",
                    bg: "black"
                },
                item:
                {
                    fg: "white",
                    bg: "black"
                },

                selected: {
                    fg: "white",
                    bg: "blue"
                }
            },
            hidden: true,
            items: [
                "Open file"
            ]
        });
        this.screen.append(this.selectedItemLine);
        this.screen.append(this.list);
        this.screen.append(contextMenu);
        this.list.focus();
        this.screen.render();

        function findItemByIndex(itemIndices, index){
            for (let i = 0; i < itemIndices.length; i++){
                let itemIndex = itemIndices[i];
                for (let j = 0; j < itemIndex.length; j++){
                    let item = itemIndex[j];
                    if (index >= item.line && index < (item.line + item.count)){
                        return {i, j, k : index - item.line};
                    }
                }
            }
            return {i: -1, j: -1, k: -1};
        }

        let selectedItem;
        let selectedIndex;

        this.list.on('select', function (item, index) {
            selectedItem = item;
            selectedIndex = index;

            contextMenu.pick(function _pick(contextCommand) {
                // FIXME: contextCommand is null
            });

        });
        contextMenu.on('select', function (item, index){
            let {i, j, k} = {...findItemByIndex(itemIndices, selectedIndex)};
            if (i < 0 || j < 0 || k < 0) {
                // nothing valid selected
                selectedItemLine.content = "";
                this.screen.render();
                return;
            }
            let hash = itemIndices[i][j].hash;
            let root = dirInfos[i].root;
            let relpath = dirInfos[i].digestIndex.get(hash)[k > 0 ? k - 1 : 0];
            
            // selectedItemLine.content = JSON.stringify({i, j, k, hash, root, relpath});
            selectedItemLine.content = `Opening... ${relpath} (${hash}) ------`;
            this.screen.render();
            
            open(path.join(root, relpath))
                .then(() => selectedItemLine.content = `Opened ${relpath} (${hash}) ------`)
                .catch(ex => selectedItemLine.content = `Failed to open ${relpath}: ${ex} ------`)
                .then(() => this.screen.render());

        });
        this.screen.key('q', function() {
            return this.destroy();
        });
          
    }

    buildDuplicateList(dirInfos) {
        let items = [];
        let itemIndices = [];
        const bsOpts = {
            units: os_platform() == 'win32' ? 'iec' : 'metric'
        };
        for (const dirInfo of dirInfos) {
            let itemIndex = [];
            // printing duplicates.
            if (dirInfo.dupsByDigest.size > 0) {
                items.push(`${dirInfo.dupsByDigest.size} duplicates in ${dirInfo.root}:`);
                items.push(`(removing duplicates could free up ${byteSize(dirInfo.bytesOccupiedByDuplicateFiles, bsOpts)})`);
                items.push("");
                for (const dupHash of dirInfo.dupsByDigest) {
                    let fnames = dirInfo.digestIndex.get(dupHash);
                    let file = dirInfo.pathIndex.get(fnames[0]);
                    let fsize = file.size;
                    itemIndex.push({ "line": items.length, hash: dupHash, count: fnames.length + 1 });
                    items.push(`${dupHash} (${byteSize(fsize, bsOpts)} × ${fnames.length})`);
                    for (const name of fnames) {
                        items.push(`\t${name}`);
                    }
                }
                items.push("");
            }
            else {
                items.push(`no duplicates in ${dirInfo.root}.`);
                items.push("");
            }
            itemIndices.push(itemIndex);
        }
        return { items, itemIndices };
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
        this.list.focus();
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

module.exports = ConsoleUI;
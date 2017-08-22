/* -*- coding: utf-8
 * Spectral Transmission tool
 *
 * Copyright 2017 Mick Phillips (mick.phillips@gmail.com)
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

// Extensions to strip from source filenames, and files to exclude.
var FN_EXCLUDE = ['.csv', '.Csv', 'CSV', 'index.html'];
// CSV matching regex
CSVMATCH = /^\s?([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)[\w,;:\t]([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)/;
// The set of active filters.
var CHART = null;
var SPECTRA = {};

var lastui;
var lastevent;

var WLMIN = 300.0;
var WLMAX = 800.0;
var WLSTEP = 2.0;

/* Required page elements:
 * #fset    - the active filter set
 * #filters - a list of available filters
 * #dyes    - a list of available dyes
 */

// Dash styles generator.
DASHES = function* () {
    var styles = [[8,4], [16,4], [4,8,4], [4,8,8]];
    var index = -1;
    while(true){
        index = (index+1) % styles.length;
        yield styles[index];
    }
}()


// ==== Spectrum base === //
function Spectrum(name) {
    this.name = name;       // name
    this.raw=null;          // raw data after fetch
    this._interp=null;      // cache for interpolated data
    this._points=null;      // cache for points as [{x: , y:}, ...]
}

Spectrum.prototype.interpolate = function () {
    // Resample raw data. Assumes input data is sorted by wavelength.
    if (!this._interp ||
        this._interp[0][0] !== WLMIN ||
        this._interp[0][this._interp[0].length-1] !== WLMAX ||
        this._interp[0].length !== 1+(WLMAX-WLMIN) / WLSTEP) {
        // Need to interpolate.
        // Invalidates previously-interpolated points.
        this._points = null;
        this._interp = [[],[]];
        var wls;
        var vals;
        [wls, vals] = this.raw;
        var i = 1; // Index into original data.
        var dw = wls[1] - wls[0];
        var dv = vals[1] - vals[0];
        for (wl = WLMIN; wl <= WLMAX; wl += WLSTEP) {
            if (wl < wls[0] | wl > wls[wls.length-1]){
                this._interp[0].push(wl);
                this._interp[1].push(0);
                continue;
            }
            if (wl > wls[i]) {
                while(wl > wls[i]) {
                    i += 1;
                }
                dvdw = (vals[i] - vals[i-1]) / wls[i] - wls[i-1];
            }
            this._interp[0].push(wl);
            this._interp[1].push(vals[i-1] + (wl - wls[i-1]) * dv/dw);
        }
    }
    return this._interp;
}

Spectrum.prototype.copy = function (name) {
    copy = new Spectrum(name);
    copy.raw = null;
    copy._interp = deepCopy(this.interpolate());

    return copy;
}

Spectrum.prototype.multiplyBy = function (other) {
    // multiplies this spectrum by other
    // invalidates previously calculated _points
    this._points = null;
    this.interpolate();
    var oldMax = Math.max(...this._interp[1])
    if (other instanceof Spectrum) {
        var m = other.interpolate()[1];
        for (var i = 0; i < this._interp[1].length; i ++) {
            this._interp[1][i] *= m[i];
        }
    } else if (Array.isArray(other)) {
        for (var i = 0; i < this._interp[1].length; i ++) {
            this._interp[1][i] *= other[i];
        }
    } else {
        for (var i = 0; i < this._interp[1].length; i ++) {
            this._interp[1][i] *= other;
        }
    }
}

Spectrum.prototype.peakwl = function () {
    if (this._interp) {
        var peakidx = this._interp[1].indexOf(Math.max(...this._interp[1]));
        return this._interp[0][peakidx];
    }
}


Spectrum.prototype.points = function () {
    // Return points as {x: xval, y: yval}
    var data = this.interpolate();
    if (this._points) {
        return this._points;
    } else {
        return data[0].map(function (v, i) {
            return {x: v, y:data[1][i]};
        })
    }
}


// === ServerSpectrum - spectrum with data from server === //
function ServerSpectrum(source, name) {
    Spectrum.call(this, name);
    this.source = source;   // source url
}

ServerSpectrum.prototype = new Spectrum();

ServerSpectrum.prototype.fetch = function ( ){
    // Fetch data for item if not already available.
    // Used deferred item to allow concurrent fetches.
    var d = $.Deferred();
    if (this.raw === null) {
    $.get(this.source,
        $.proxy(function(resp){
            // Parse csv.
            var csv = resp.split('\n');
            var wls = []
            var vals = []
            for (let [index, line] of csv.entries()) {
                if (null !== line.match(CSVMATCH)) {
                    var wl, value;
                    [wl, value] = line.trim().split(/[,;:\s\t]/);
                    wls.push(parseFloat(wl));
                    vals.push(parseFloat(value));
                }
            }
            // Find max. intensity in spectrum.
            if (vals.reduce( (peak, val) => val > peak ? val : peak) > 10.) {
                // Spectrum is probably in percent
                for (var i = 0; i < vals.length; i++) {
                    vals[i] = vals[i] / 100;
                }
            }
            this.raw = [wls, vals];
            d.resolve();
        }, this),
        'text');
    } else {
        d.resolve();
    }
    return d;
}

// === End of prototype definitions === //


function wavelengthToHue(wl) {
    // Convert a wavelength to HSL-alpha string.
    return Math.max(0., Math.min(300, 650-wl)) * 0.96;
}


function updatePlot() {
    // Prepare to redraw the plot.
    var dye = [];
    var filters = [];
    var filterModes = [];

    // Fetch configuration from UI.
    $( "#dyes .ui-selected").each(function() {dye.push($(this).data().key)})
    $( "#fset .activeFilter").each(function() {filters.push($(this).data().key)})
    $( "#fset .activeFilter").each(function() {filterModes.push($(this).data().mode)})

    // Fetch all data with concurrent calls.
    var defer = [];   
    if (dye.length > 0){
        defer.push(SPECTRA[dye[0]].fetch());
    }
    for (var f of filters) {
        defer.push(SPECTRA[f].fetch());
    }

    // When all the data is ready, do the calculation and draw the plot.
    $.when.apply(null, defer).then(function(){drawPlot(dye[0], filters, filterModes)});
}


function deepCopy( src ) {
    // Deep copy an array of arrays.
    var i, target;
    if ( Array.isArray( src ) ) {
        target = src.slice(0);
        for( i = 0; i < target.length; i+=1 ) {
            target[i] = deepCopy( target[i] );
        }
        return target;
    } else {
        return src;
    }
}


function drawPlot(dye, filters, filterModes) {
    // Create chart if it doesn't exist.
    if (!CHART) {
        var ctx = $( "#chart" )[0].getContext('2d');
        CHART = new Chart(ctx, {
            type: 'scatter',
            height: `100%`,
            data: {
                datasets: [{
                    label: 'transmitted',
                    data: [],
                    borderWidth: 4,
                    borderColor: `rgba(0, 0, 0, 0.5)`,
                    pointRadius: 0,
                }]
            },
            options:{
                responsive: true,
                maintainAspectRatio: false,
            }
        });
        // Set chart height now, and on window resize.
        var resizeChart = () => {
            var frac = Math.floor(100*Math.min(
                (1- $( CHART.canvas ).position().top / $( window ).height()),
                $( CHART.canvas ).width() / $( window ).height()));
            CHART.canvas.parentNode.style.height = `${frac}vh`;
        }
        resizeChart();
        $(window).resize(resizeChart);
    }

    // Calculate transmission.
    if (dye) {
        SPECTRA['transmitted'] = SPECTRA[dye].copy();
    }
    for ([findex, filter] of filters.entries()) {
        if (findex === 0 && !dye) {
            // If there was no dye, initialize from first filter.
            SPECTRA['transmitted'] = SPECTRA[filter].copy();
            continue
        }
        var refl = ['r','R'].indexOf(filterModes[findex]) > -1;
        if (refl) {
            var mult = SPECTRA[filter].interpolate()[1].map((v) => {return 1-v;});
            SPECTRA['transmitted'].multiplyBy(mult);
        } else {
            SPECTRA['transmitted'].multiplyBy(SPECTRA[filter]);
        }
    }

    var skeys = []; // all active keys (filters + dye)
    $("#dyes .ui-selected").each(function() {skeys.push($(this).data().key)});
    skeys.push.apply(skeys, filters);

    var traces = CHART.data.datasets.map( item => item.label );
    var toRemove = traces.filter(item => skeys.indexOf(item) === -1);
    var toAdd = skeys.filter(item => traces.indexOf(item) === -1 );

    // Remove traces that are no longer needed.
    for (var key of toRemove) {
        if (key == 'transmitted') { continue }
        CHART.data.datasets.splice(
            CHART.data.datasets.indexOf(
                CHART.data.datasets.filter(item => item.label == key)[0]), 1);
    }

    // Add new traces.
    for (var key of toAdd) {
        var bg;
        var fg;
        var borderDash;
        var data = SPECTRA[key].points();
        var hue = wavelengthToHue(SPECTRA[key].peakwl());
        bg = `hsla(${hue}, 100%, 50%, 0.2)`
        fg = `hsla(${hue}, 100%, 50%, 0.5)`
        if (filters.indexOf(key) > -1){
            borderDash = DASHES.next().value;
        } else {
            borderDash = [];
        }

        CHART.data.datasets.push({
            label: key,
            data: data,
            backgroundColor: bg,
            pointRadius: 0,
            borderDash: borderDash,
            borderColor: fg,
        });
    }

    // Update the transmission trace.
    var transTrace = CHART.data.datasets.filter( item => item.label == 'transmitted')[0]
    var hue = wavelengthToHue(SPECTRA['transmitted'].peakwl());
    transTrace.data = SPECTRA['transmitted'].points();
    transTrace.backgroundColor = `hsla(${hue}, 100%, 50%, 0.9)`

    CHART.update();
}


function parseSources( sources )  {
    // Parse a \n-separated list of source files.
    var filters = {};
    for (var file of sources.split('\n')) {
        var name = file;
        for (var excl of FN_EXCLUDE) {
            name = name.split(excl).join("");
        }
        if (name.length > 1) {
            filters[name] = file;
        }
    }
    return filters
}


//=== UI INTERACTION FUNCTIONS ===//
function addFilter( event, ui) {
    // Add a filter to the active filter set.
    var el = ui.draggable.clone(true).removeClass('filterSpec').addClass('activeFilter');
    el.data('mode', 't')
    var buttons = $( "<span></span>").appendTo(el);
    var modeBtn = $(`<button class="modeButton">t</button>`).appendTo(buttons);
    modeBtn.button()
    modeBtn.click(function(){
        var newMode = {'t':'r', 'r':'t'}[el.data('mode')];
        el.data('mode', newMode);
        $( this ).text(newMode);
        updatePlot();
    });
    var delBtn = $(`<button class="delButton">x</button>`).appendTo(buttons);
    delBtn.button();
    delBtn.click(function(){
        el.remove();
        updatePlot();});
    $( "#fset" ).append(el);
    updatePlot();
}

function selectDye( event, ui) {
    // Update on dye selection.
    $(ui.selected).addClass("ui-selected").siblings().removeClass("ui-selected");
    updatePlot();
}


//=== DOCUMENT READY===//
$( document ).ready(function() { 
    // Populate list of filters, and store SPECTRA key on the div.data
    $.ajax(
        {url: "./filters",
         data: "",
         dataType: "text",
         success: function( resp ) {
            var filters = parseSources(resp);
            var divs = []
            $.each(filters, function(key, value) {
                SPECTRA[key] = new ServerSpectrum(`filters/${value}`, key);
                var div = $( `<div><label>${key}</label></div>`);
                div.addClass( "filterSpec" );
                div.data('key', key);
                divs.push(div);
            });
            $( "#filters" ).append(divs);
            $( ".filterSpec").draggable({helper: "clone", cursor:"move"});
        }
    });
    $( "#fset").droppable({
        accept: ".filterSpec",
        drop: addFilter
    });
    
    // Populate list of dyes, and store SPECTRA key on the div.data
    $.ajax(
        {url: "./dyes",
         data: "",
         dataType: "text",
         success: function( data ) {
            var dyes = parseSources(data);
            var divs = []
            $.each(dyes, function(key, value) {
                var div = $(`<div>${key}</div>`);
                SPECTRA[key] = new ServerSpectrum(`dyes/${value}`, key);
                div.data('key', key);
                divs.push(div);
            });
            $( "#dyes" ).append(divs);
            $( "#dyes" ).selectable({selected: selectDye});
        ;}
    });
    // To do - parse URL to select dye and populate fset.
});
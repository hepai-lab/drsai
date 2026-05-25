(self["webpackChunkopen_drsai"] = self["webpackChunkopen_drsai"] || []).push([[306],{

/***/ 44582:
/***/ (function(__unused_webpack_module, exports) {

"use strict";


/**
 * Ponyfill for `Array.prototype.find` which is only available in ES6 runtimes.
 *
 * Works with anything that has a `length` property and index access properties, including NodeList.
 *
 * @template {unknown} T
 * @param {Array<T> | ({length:number, [number]: T})} list
 * @param {function (item: T, index: number, list:Array<T> | ({length:number, [number]: T})):boolean} predicate
 * @param {Partial<Pick<ArrayConstructor['prototype'], 'find'>>?} ac `Array.prototype` by default,
 * 				allows injecting a custom implementation in tests
 * @returns {T | undefined}
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/find
 * @see https://tc39.es/ecma262/multipage/indexed-collections.html#sec-array.prototype.find
 */
function find(list, predicate, ac) {
	if (ac === undefined) {
		ac = Array.prototype;
	}
	if (list && typeof ac.find === 'function') {
		return ac.find.call(list, predicate);
	}
	for (var i = 0; i < list.length; i++) {
		if (Object.prototype.hasOwnProperty.call(list, i)) {
			var item = list[i];
			if (predicate.call(undefined, item, i, list)) {
				return item;
			}
		}
	}
}

/**
 * "Shallow freezes" an object to render it immutable.
 * Uses `Object.freeze` if available,
 * otherwise the immutability is only in the type.
 *
 * Is used to create "enum like" objects.
 *
 * @template T
 * @param {T} object the object to freeze
 * @param {Pick<ObjectConstructor, 'freeze'> = Object} oc `Object` by default,
 * 				allows to inject custom object constructor for tests
 * @returns {Readonly<T>}
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/freeze
 */
function freeze(object, oc) {
	if (oc === undefined) {
		oc = Object
	}
	return oc && typeof oc.freeze === 'function' ? oc.freeze(object) : object
}

/**
 * Since we can not rely on `Object.assign` we provide a simplified version
 * that is sufficient for our needs.
 *
 * @param {Object} target
 * @param {Object | null | undefined} source
 *
 * @returns {Object} target
 * @throws TypeError if target is not an object
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign
 * @see https://tc39.es/ecma262/multipage/fundamental-objects.html#sec-object.assign
 */
function assign(target, source) {
	if (target === null || typeof target !== 'object') {
		throw new TypeError('target is not an object')
	}
	for (var key in source) {
		if (Object.prototype.hasOwnProperty.call(source, key)) {
			target[key] = source[key]
		}
	}
	return target
}

/**
 * All mime types that are allowed as input to `DOMParser.parseFromString`
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString#Argument02 MDN
 * @see https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#domparsersupportedtype WHATWG HTML Spec
 * @see DOMParser.prototype.parseFromString
 */
var MIME_TYPE = freeze({
	/**
	 * `text/html`, the only mime type that triggers treating an XML document as HTML.
	 *
	 * @see DOMParser.SupportedType.isHTML
	 * @see https://www.iana.org/assignments/media-types/text/html IANA MimeType registration
	 * @see https://en.wikipedia.org/wiki/HTML Wikipedia
	 * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString MDN
	 * @see https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-domparser-parsefromstring WHATWG HTML Spec
	 */
	HTML: 'text/html',

	/**
	 * Helper method to check a mime type if it indicates an HTML document
	 *
	 * @param {string} [value]
	 * @returns {boolean}
	 *
	 * @see https://www.iana.org/assignments/media-types/text/html IANA MimeType registration
	 * @see https://en.wikipedia.org/wiki/HTML Wikipedia
	 * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser/parseFromString MDN
	 * @see https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-domparser-parsefromstring 	 */
	isHTML: function (value) {
		return value === MIME_TYPE.HTML
	},

	/**
	 * `application/xml`, the standard mime type for XML documents.
	 *
	 * @see https://www.iana.org/assignments/media-types/application/xml IANA MimeType registration
	 * @see https://tools.ietf.org/html/rfc7303#section-9.1 RFC 7303
	 * @see https://en.wikipedia.org/wiki/XML_and_MIME Wikipedia
	 */
	XML_APPLICATION: 'application/xml',

	/**
	 * `text/html`, an alias for `application/xml`.
	 *
	 * @see https://tools.ietf.org/html/rfc7303#section-9.2 RFC 7303
	 * @see https://www.iana.org/assignments/media-types/text/xml IANA MimeType registration
	 * @see https://en.wikipedia.org/wiki/XML_and_MIME Wikipedia
	 */
	XML_TEXT: 'text/xml',

	/**
	 * `application/xhtml+xml`, indicates an XML document that has the default HTML namespace,
	 * but is parsed as an XML document.
	 *
	 * @see https://www.iana.org/assignments/media-types/application/xhtml+xml IANA MimeType registration
	 * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocument WHATWG DOM Spec
	 * @see https://en.wikipedia.org/wiki/XHTML Wikipedia
	 */
	XML_XHTML_APPLICATION: 'application/xhtml+xml',

	/**
	 * `image/svg+xml`,
	 *
	 * @see https://www.iana.org/assignments/media-types/image/svg+xml IANA MimeType registration
	 * @see https://www.w3.org/TR/SVG11/ W3C SVG 1.1
	 * @see https://en.wikipedia.org/wiki/Scalable_Vector_Graphics Wikipedia
	 */
	XML_SVG_IMAGE: 'image/svg+xml',
})

/**
 * Namespaces that are used in this code base.
 *
 * @see http://www.w3.org/TR/REC-xml-names
 */
var NAMESPACE = freeze({
	/**
	 * The XHTML namespace.
	 *
	 * @see http://www.w3.org/1999/xhtml
	 */
	HTML: 'http://www.w3.org/1999/xhtml',

	/**
	 * Checks if `uri` equals `NAMESPACE.HTML`.
	 *
	 * @param {string} [uri]
	 *
	 * @see NAMESPACE.HTML
	 */
	isHTML: function (uri) {
		return uri === NAMESPACE.HTML
	},

	/**
	 * The SVG namespace.
	 *
	 * @see http://www.w3.org/2000/svg
	 */
	SVG: 'http://www.w3.org/2000/svg',

	/**
	 * The `xml:` namespace.
	 *
	 * @see http://www.w3.org/XML/1998/namespace
	 */
	XML: 'http://www.w3.org/XML/1998/namespace',

	/**
	 * The `xmlns:` namespace
	 *
	 * @see https://www.w3.org/2000/xmlns/
	 */
	XMLNS: 'http://www.w3.org/2000/xmlns/',
})

exports.assign = assign;
exports.find = find;
exports.freeze = freeze;
exports.MIME_TYPE = MIME_TYPE;
exports.NAMESPACE = NAMESPACE;


/***/ }),

/***/ 15752:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;
var conventions = __webpack_require__(44582);
var dom = __webpack_require__(84722)
var entities = __webpack_require__(56559);
var sax = __webpack_require__(64466);

var DOMImplementation = dom.DOMImplementation;

var NAMESPACE = conventions.NAMESPACE;

var ParseError = sax.ParseError;
var XMLReader = sax.XMLReader;

/**
 * Normalizes line ending according to https://www.w3.org/TR/xml11/#sec-line-ends:
 *
 * > XML parsed entities are often stored in computer files which,
 * > for editing convenience, are organized into lines.
 * > These lines are typically separated by some combination
 * > of the characters CARRIAGE RETURN (#xD) and LINE FEED (#xA).
 * >
 * > To simplify the tasks of applications, the XML processor must behave
 * > as if it normalized all line breaks in external parsed entities (including the document entity)
 * > on input, before parsing, by translating all of the following to a single #xA character:
 * >
 * > 1. the two-character sequence #xD #xA
 * > 2. the two-character sequence #xD #x85
 * > 3. the single character #x85
 * > 4. the single character #x2028
 * > 5. any #xD character that is not immediately followed by #xA or #x85.
 *
 * @param {string} input
 * @returns {string}
 */
function normalizeLineEndings(input) {
	return input
		.replace(/\r[\n\u0085]/g, '\n')
		.replace(/[\r\u0085\u2028]/g, '\n')
}

/**
 * @typedef Locator
 * @property {number} [columnNumber]
 * @property {number} [lineNumber]
 */

/**
 * @typedef DOMParserOptions
 * @property {DOMHandler} [domBuilder]
 * @property {Function} [errorHandler]
 * @property {(string) => string} [normalizeLineEndings] used to replace line endings before parsing
 * 						defaults to `normalizeLineEndings`
 * @property {Locator} [locator]
 * @property {Record<string, string>} [xmlns]
 *
 * @see normalizeLineEndings
 */

/**
 * The DOMParser interface provides the ability to parse XML or HTML source code
 * from a string into a DOM `Document`.
 *
 * _xmldom is different from the spec in that it allows an `options` parameter,
 * to override the default behavior._
 *
 * @param {DOMParserOptions} [options]
 * @constructor
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMParser
 * @see https://html.spec.whatwg.org/multipage/dynamic-markup-insertion.html#dom-parsing-and-serialization
 */
function DOMParser(options){
	this.options = options ||{locator:{}};
}

DOMParser.prototype.parseFromString = function(source,mimeType){
	var options = this.options;
	var sax =  new XMLReader();
	var domBuilder = options.domBuilder || new DOMHandler();//contentHandler and LexicalHandler
	var errorHandler = options.errorHandler;
	var locator = options.locator;
	var defaultNSMap = options.xmlns||{};
	var isHTML = /\/x?html?$/.test(mimeType);//mimeType.toLowerCase().indexOf('html') > -1;
  	var entityMap = isHTML ? entities.HTML_ENTITIES : entities.XML_ENTITIES;
	if(locator){
		domBuilder.setDocumentLocator(locator)
	}

	sax.errorHandler = buildErrorHandler(errorHandler,domBuilder,locator);
	sax.domBuilder = options.domBuilder || domBuilder;
	if(isHTML){
		defaultNSMap[''] = NAMESPACE.HTML;
	}
	defaultNSMap.xml = defaultNSMap.xml || NAMESPACE.XML;
	var normalize = options.normalizeLineEndings || normalizeLineEndings;
	if (source && typeof source === 'string') {
		sax.parse(
			normalize(source),
			defaultNSMap,
			entityMap
		)
	} else {
		sax.errorHandler.error('invalid doc source')
	}
	return domBuilder.doc;
}
function buildErrorHandler(errorImpl,domBuilder,locator){
	if(!errorImpl){
		if(domBuilder instanceof DOMHandler){
			return domBuilder;
		}
		errorImpl = domBuilder ;
	}
	var errorHandler = {}
	var isCallback = errorImpl instanceof Function;
	locator = locator||{}
	function build(key){
		var fn = errorImpl[key];
		if(!fn && isCallback){
			fn = errorImpl.length == 2?function(msg){errorImpl(key,msg)}:errorImpl;
		}
		errorHandler[key] = fn && function(msg){
			fn('[xmldom '+key+']\t'+msg+_locator(locator));
		}||function(){};
	}
	build('warning');
	build('error');
	build('fatalError');
	return errorHandler;
}

//console.log('#\n\n\n\n\n\n\n####')
/**
 * +ContentHandler+ErrorHandler
 * +LexicalHandler+EntityResolver2
 * -DeclHandler-DTDHandler
 *
 * DefaultHandler:EntityResolver, DTDHandler, ContentHandler, ErrorHandler
 * DefaultHandler2:DefaultHandler,LexicalHandler, DeclHandler, EntityResolver2
 * @link http://www.saxproject.org/apidoc/org/xml/sax/helpers/DefaultHandler.html
 */
function DOMHandler() {
    this.cdata = false;
}
function position(locator,node){
	node.lineNumber = locator.lineNumber;
	node.columnNumber = locator.columnNumber;
}
/**
 * @see org.xml.sax.ContentHandler#startDocument
 * @link http://www.saxproject.org/apidoc/org/xml/sax/ContentHandler.html
 */
DOMHandler.prototype = {
	startDocument : function() {
    	this.doc = new DOMImplementation().createDocument(null, null, null);
    	if (this.locator) {
        	this.doc.documentURI = this.locator.systemId;
    	}
	},
	startElement:function(namespaceURI, localName, qName, attrs) {
		var doc = this.doc;
	    var el = doc.createElementNS(namespaceURI, qName||localName);
	    var len = attrs.length;
	    appendElement(this, el);
	    this.currentElement = el;

		this.locator && position(this.locator,el)
	    for (var i = 0 ; i < len; i++) {
	        var namespaceURI = attrs.getURI(i);
	        var value = attrs.getValue(i);
	        var qName = attrs.getQName(i);
			var attr = doc.createAttributeNS(namespaceURI, qName);
			this.locator &&position(attrs.getLocator(i),attr);
			attr.value = attr.nodeValue = value;
			el.setAttributeNode(attr)
	    }
	},
	endElement:function(namespaceURI, localName, qName) {
		var current = this.currentElement
		var tagName = current.tagName;
		this.currentElement = current.parentNode;
	},
	startPrefixMapping:function(prefix, uri) {
	},
	endPrefixMapping:function(prefix) {
	},
	processingInstruction:function(target, data) {
	    var ins = this.doc.createProcessingInstruction(target, data);
	    this.locator && position(this.locator,ins)
	    appendElement(this, ins);
	},
	ignorableWhitespace:function(ch, start, length) {
	},
	characters:function(chars, start, length) {
		chars = _toString.apply(this,arguments)
		//console.log(chars)
		if(chars){
			if (this.cdata) {
				var charNode = this.doc.createCDATASection(chars);
			} else {
				var charNode = this.doc.createTextNode(chars);
			}
			if(this.currentElement){
				this.currentElement.appendChild(charNode);
			}else if(/^\s*$/.test(chars)){
				this.doc.appendChild(charNode);
				//process xml
			}
			this.locator && position(this.locator,charNode)
		}
	},
	skippedEntity:function(name) {
	},
	endDocument:function() {
		this.doc.normalize();
	},
	setDocumentLocator:function (locator) {
	    if(this.locator = locator){// && !('lineNumber' in locator)){
	    	locator.lineNumber = 0;
	    }
	},
	//LexicalHandler
	comment:function(chars, start, length) {
		chars = _toString.apply(this,arguments)
	    var comm = this.doc.createComment(chars);
	    this.locator && position(this.locator,comm)
	    appendElement(this, comm);
	},

	startCDATA:function() {
	    //used in characters() methods
	    this.cdata = true;
	},
	endCDATA:function() {
	    this.cdata = false;
	},

	startDTD:function(name, publicId, systemId) {
		var impl = this.doc.implementation;
	    if (impl && impl.createDocumentType) {
	        var dt = impl.createDocumentType(name, publicId, systemId);
	        this.locator && position(this.locator,dt)
	        appendElement(this, dt);
					this.doc.doctype = dt;
	    }
	},
	/**
	 * @see org.xml.sax.ErrorHandler
	 * @link http://www.saxproject.org/apidoc/org/xml/sax/ErrorHandler.html
	 */
	warning:function(error) {
		console.warn('[xmldom warning]\t'+error,_locator(this.locator));
	},
	error:function(error) {
		console.error('[xmldom error]\t'+error,_locator(this.locator));
	},
	fatalError:function(error) {
		throw new ParseError(error, this.locator);
	}
}
function _locator(l){
	if(l){
		return '\n@'+(l.systemId ||'')+'#[line:'+l.lineNumber+',col:'+l.columnNumber+']'
	}
}
function _toString(chars,start,length){
	if(typeof chars == 'string'){
		return chars.substr(start,length)
	}else{//java sax connect width xmldom on rhino(what about: "? && !(chars instanceof String)")
		if(chars.length >= start+length || start){
			return new java.lang.String(chars,start,length)+'';
		}
		return chars;
	}
}

/*
 * @link http://www.saxproject.org/apidoc/org/xml/sax/ext/LexicalHandler.html
 * used method of org.xml.sax.ext.LexicalHandler:
 *  #comment(chars, start, length)
 *  #startCDATA()
 *  #endCDATA()
 *  #startDTD(name, publicId, systemId)
 *
 *
 * IGNORED method of org.xml.sax.ext.LexicalHandler:
 *  #endDTD()
 *  #startEntity(name)
 *  #endEntity(name)
 *
 *
 * @link http://www.saxproject.org/apidoc/org/xml/sax/ext/DeclHandler.html
 * IGNORED method of org.xml.sax.ext.DeclHandler
 * 	#attributeDecl(eName, aName, type, mode, value)
 *  #elementDecl(name, model)
 *  #externalEntityDecl(name, publicId, systemId)
 *  #internalEntityDecl(name, value)
 * @link http://www.saxproject.org/apidoc/org/xml/sax/ext/EntityResolver2.html
 * IGNORED method of org.xml.sax.EntityResolver2
 *  #resolveEntity(String name,String publicId,String baseURI,String systemId)
 *  #resolveEntity(publicId, systemId)
 *  #getExternalSubset(name, baseURI)
 * @link http://www.saxproject.org/apidoc/org/xml/sax/DTDHandler.html
 * IGNORED method of org.xml.sax.DTDHandler
 *  #notationDecl(name, publicId, systemId) {};
 *  #unparsedEntityDecl(name, publicId, systemId, notationName) {};
 */
"endDTD,startEntity,endEntity,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,resolveEntity,getExternalSubset,notationDecl,unparsedEntityDecl".replace(/\w+/g,function(key){
	DOMHandler.prototype[key] = function(){return null}
})

/* Private static helpers treated below as private instance methods, so don't need to add these to the public API; we might use a Relator to also get rid of non-standard public properties */
function appendElement (hander,node) {
    if (!hander.currentElement) {
        hander.doc.appendChild(node);
    } else {
        hander.currentElement.appendChild(node);
    }
}//appendChild and setAttributeNS are preformance key

__webpack_unused_export__ = DOMHandler;
__webpack_unused_export__ = normalizeLineEndings;
exports.DOMParser = DOMParser;


/***/ }),

/***/ 84722:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var conventions = __webpack_require__(44582);

var find = conventions.find;
var NAMESPACE = conventions.NAMESPACE;

/**
 * A prerequisite for `[].filter`, to drop elements that are empty
 * @param {string} input
 * @returns {boolean}
 */
function notEmptyString (input) {
	return input !== ''
}
/**
 * @see https://infra.spec.whatwg.org/#split-on-ascii-whitespace
 * @see https://infra.spec.whatwg.org/#ascii-whitespace
 *
 * @param {string} input
 * @returns {string[]} (can be empty)
 */
function splitOnASCIIWhitespace(input) {
	// U+0009 TAB, U+000A LF, U+000C FF, U+000D CR, U+0020 SPACE
	return input ? input.split(/[\t\n\f\r ]+/).filter(notEmptyString) : []
}

/**
 * Adds element as a key to current if it is not already present.
 *
 * @param {Record<string, boolean | undefined>} current
 * @param {string} element
 * @returns {Record<string, boolean | undefined>}
 */
function orderedSetReducer (current, element) {
	if (!current.hasOwnProperty(element)) {
		current[element] = true;
	}
	return current;
}

/**
 * @see https://infra.spec.whatwg.org/#ordered-set
 * @param {string} input
 * @returns {string[]}
 */
function toOrderedSet(input) {
	if (!input) return [];
	var list = splitOnASCIIWhitespace(input);
	return Object.keys(list.reduce(orderedSetReducer, {}))
}

/**
 * Uses `list.indexOf` to implement something like `Array.prototype.includes`,
 * which we can not rely on being available.
 *
 * @param {any[]} list
 * @returns {function(any): boolean}
 */
function arrayIncludes (list) {
	return function(element) {
		return list && list.indexOf(element) !== -1;
	}
}

function copy(src,dest){
	for(var p in src){
		if (Object.prototype.hasOwnProperty.call(src, p)) {
			dest[p] = src[p];
		}
	}
}

/**
^\w+\.prototype\.([_\w]+)\s*=\s*((?:.*\{\s*?[\r\n][\s\S]*?^})|\S.*?(?=[;\r\n]));?
^\w+\.prototype\.([_\w]+)\s*=\s*(\S.*?(?=[;\r\n]));?
 */
function _extends(Class,Super){
	var pt = Class.prototype;
	if(!(pt instanceof Super)){
		function t(){};
		t.prototype = Super.prototype;
		t = new t();
		copy(pt,t);
		Class.prototype = pt = t;
	}
	if(pt.constructor != Class){
		if(typeof Class != 'function'){
			console.error("unknown Class:"+Class)
		}
		pt.constructor = Class
	}
}

// Node Types
var NodeType = {}
var ELEMENT_NODE                = NodeType.ELEMENT_NODE                = 1;
var ATTRIBUTE_NODE              = NodeType.ATTRIBUTE_NODE              = 2;
var TEXT_NODE                   = NodeType.TEXT_NODE                   = 3;
var CDATA_SECTION_NODE          = NodeType.CDATA_SECTION_NODE          = 4;
var ENTITY_REFERENCE_NODE       = NodeType.ENTITY_REFERENCE_NODE       = 5;
var ENTITY_NODE                 = NodeType.ENTITY_NODE                 = 6;
var PROCESSING_INSTRUCTION_NODE = NodeType.PROCESSING_INSTRUCTION_NODE = 7;
var COMMENT_NODE                = NodeType.COMMENT_NODE                = 8;
var DOCUMENT_NODE               = NodeType.DOCUMENT_NODE               = 9;
var DOCUMENT_TYPE_NODE          = NodeType.DOCUMENT_TYPE_NODE          = 10;
var DOCUMENT_FRAGMENT_NODE      = NodeType.DOCUMENT_FRAGMENT_NODE      = 11;
var NOTATION_NODE               = NodeType.NOTATION_NODE               = 12;

// ExceptionCode
var ExceptionCode = {}
var ExceptionMessage = {};
var INDEX_SIZE_ERR              = ExceptionCode.INDEX_SIZE_ERR              = ((ExceptionMessage[1]="Index size error"),1);
var DOMSTRING_SIZE_ERR          = ExceptionCode.DOMSTRING_SIZE_ERR          = ((ExceptionMessage[2]="DOMString size error"),2);
var HIERARCHY_REQUEST_ERR       = ExceptionCode.HIERARCHY_REQUEST_ERR       = ((ExceptionMessage[3]="Hierarchy request error"),3);
var WRONG_DOCUMENT_ERR          = ExceptionCode.WRONG_DOCUMENT_ERR          = ((ExceptionMessage[4]="Wrong document"),4);
var INVALID_CHARACTER_ERR       = ExceptionCode.INVALID_CHARACTER_ERR       = ((ExceptionMessage[5]="Invalid character"),5);
var NO_DATA_ALLOWED_ERR         = ExceptionCode.NO_DATA_ALLOWED_ERR         = ((ExceptionMessage[6]="No data allowed"),6);
var NO_MODIFICATION_ALLOWED_ERR = ExceptionCode.NO_MODIFICATION_ALLOWED_ERR = ((ExceptionMessage[7]="No modification allowed"),7);
var NOT_FOUND_ERR               = ExceptionCode.NOT_FOUND_ERR               = ((ExceptionMessage[8]="Not found"),8);
var NOT_SUPPORTED_ERR           = ExceptionCode.NOT_SUPPORTED_ERR           = ((ExceptionMessage[9]="Not supported"),9);
var INUSE_ATTRIBUTE_ERR         = ExceptionCode.INUSE_ATTRIBUTE_ERR         = ((ExceptionMessage[10]="Attribute in use"),10);
//level2
var INVALID_STATE_ERR        	= ExceptionCode.INVALID_STATE_ERR        	= ((ExceptionMessage[11]="Invalid state"),11);
var SYNTAX_ERR               	= ExceptionCode.SYNTAX_ERR               	= ((ExceptionMessage[12]="Syntax error"),12);
var INVALID_MODIFICATION_ERR 	= ExceptionCode.INVALID_MODIFICATION_ERR 	= ((ExceptionMessage[13]="Invalid modification"),13);
var NAMESPACE_ERR            	= ExceptionCode.NAMESPACE_ERR           	= ((ExceptionMessage[14]="Invalid namespace"),14);
var INVALID_ACCESS_ERR       	= ExceptionCode.INVALID_ACCESS_ERR      	= ((ExceptionMessage[15]="Invalid access"),15);

/**
 * DOM Level 2
 * Object DOMException
 * @see http://www.w3.org/TR/2000/REC-DOM-Level-2-Core-20001113/ecma-script-binding.html
 * @see http://www.w3.org/TR/REC-DOM-Level-1/ecma-script-language-binding.html
 */
function DOMException(code, message) {
	if(message instanceof Error){
		var error = message;
	}else{
		error = this;
		Error.call(this, ExceptionMessage[code]);
		this.message = ExceptionMessage[code];
		if(Error.captureStackTrace) Error.captureStackTrace(this, DOMException);
	}
	error.code = code;
	if(message) this.message = this.message + ": " + message;
	return error;
};
DOMException.prototype = Error.prototype;
copy(ExceptionCode,DOMException)

/**
 * @see http://www.w3.org/TR/2000/REC-DOM-Level-2-Core-20001113/core.html#ID-536297177
 * The NodeList interface provides the abstraction of an ordered collection of nodes, without defining or constraining how this collection is implemented. NodeList objects in the DOM are live.
 * The items in the NodeList are accessible via an integral index, starting from 0.
 */
function NodeList() {
};
NodeList.prototype = {
	/**
	 * The number of nodes in the list. The range of valid child node indices is 0 to length-1 inclusive.
	 * @standard level1
	 */
	length:0,
	/**
	 * Returns the indexth item in the collection. If index is greater than or equal to the number of nodes in the list, this returns null.
	 * @standard level1
	 * @param index  unsigned long
	 *   Index into the collection.
	 * @return Node
	 * 	The node at the indexth position in the NodeList, or null if that is not a valid index.
	 */
	item: function(index) {
		return index >= 0 && index < this.length ? this[index] : null;
	},
	toString:function(isHTML,nodeFilter,options){
		var requireWellFormed = !!options && !!options.requireWellFormed;
		for(var buf = [], i = 0;i<this.length;i++){
			serializeToString(this[i],buf,isHTML,nodeFilter,null,requireWellFormed);
		}
		return buf.join('');
	},
	/**
	 * @private
	 * @param {function (Node):boolean} predicate
	 * @returns {Node[]}
	 */
	filter: function (predicate) {
		return Array.prototype.filter.call(this, predicate);
	},
	/**
	 * @private
	 * @param {Node} item
	 * @returns {number}
	 */
	indexOf: function (item) {
		return Array.prototype.indexOf.call(this, item);
	},
};

function LiveNodeList(node,refresh){
	this._node = node;
	this._refresh = refresh
	_updateLiveList(this);
}
function _updateLiveList(list){
	var inc = list._node._inc || list._node.ownerDocument._inc;
	if (list._inc !== inc) {
		var ls = list._refresh(list._node);
		__set__(list,'length',ls.length);
		if (!list.$$length || ls.length < list.$$length) {
			for (var i = ls.length; i in list; i++) {
				if (Object.prototype.hasOwnProperty.call(list, i)) {
					delete list[i];
				}
			}
		}
		copy(ls,list);
		list._inc = inc;
	}
}
LiveNodeList.prototype.item = function(i){
	_updateLiveList(this);
	return this[i] || null;
}

_extends(LiveNodeList,NodeList);

/**
 * Objects implementing the NamedNodeMap interface are used
 * to represent collections of nodes that can be accessed by name.
 * Note that NamedNodeMap does not inherit from NodeList;
 * NamedNodeMaps are not maintained in any particular order.
 * Objects contained in an object implementing NamedNodeMap may also be accessed by an ordinal index,
 * but this is simply to allow convenient enumeration of the contents of a NamedNodeMap,
 * and does not imply that the DOM specifies an order to these Nodes.
 * NamedNodeMap objects in the DOM are live.
 * used for attributes or DocumentType entities
 */
function NamedNodeMap() {
};

function _findNodeIndex(list,node){
	var i = list.length;
	while(i--){
		if(list[i] === node){return i}
	}
}

function _addNamedNode(el,list,newAttr,oldAttr){
	if(oldAttr){
		list[_findNodeIndex(list,oldAttr)] = newAttr;
	}else{
		list[list.length++] = newAttr;
	}
	if(el){
		newAttr.ownerElement = el;
		var doc = el.ownerDocument;
		if(doc){
			oldAttr && _onRemoveAttribute(doc,el,oldAttr);
			_onAddAttribute(doc,el,newAttr);
		}
	}
}
function _removeNamedNode(el,list,attr){
	//console.log('remove attr:'+attr)
	var i = _findNodeIndex(list,attr);
	if(i>=0){
		var lastIndex = list.length-1
		while(i<lastIndex){
			list[i] = list[++i]
		}
		list.length = lastIndex;
		if(el){
			var doc = el.ownerDocument;
			if(doc){
				_onRemoveAttribute(doc,el,attr);
				attr.ownerElement = null;
			}
		}
	}else{
		throw new DOMException(NOT_FOUND_ERR,new Error(el.tagName+'@'+attr))
	}
}
NamedNodeMap.prototype = {
	length:0,
	item:NodeList.prototype.item,
	getNamedItem: function(key) {
//		if(key.indexOf(':')>0 || key == 'xmlns'){
//			return null;
//		}
		//console.log()
		var i = this.length;
		while(i--){
			var attr = this[i];
			//console.log(attr.nodeName,key)
			if(attr.nodeName == key){
				return attr;
			}
		}
	},
	setNamedItem: function(attr) {
		var el = attr.ownerElement;
		if(el && el!=this._ownerElement){
			throw new DOMException(INUSE_ATTRIBUTE_ERR);
		}
		var oldAttr = this.getNamedItem(attr.nodeName);
		_addNamedNode(this._ownerElement,this,attr,oldAttr);
		return oldAttr;
	},
	/* returns Node */
	setNamedItemNS: function(attr) {// raises: WRONG_DOCUMENT_ERR,NO_MODIFICATION_ALLOWED_ERR,INUSE_ATTRIBUTE_ERR
		var el = attr.ownerElement, oldAttr;
		if(el && el!=this._ownerElement){
			throw new DOMException(INUSE_ATTRIBUTE_ERR);
		}
		oldAttr = this.getNamedItemNS(attr.namespaceURI,attr.localName);
		_addNamedNode(this._ownerElement,this,attr,oldAttr);
		return oldAttr;
	},

	/* returns Node */
	removeNamedItem: function(key) {
		var attr = this.getNamedItem(key);
		_removeNamedNode(this._ownerElement,this,attr);
		return attr;


	},// raises: NOT_FOUND_ERR,NO_MODIFICATION_ALLOWED_ERR

	//for level2
	removeNamedItemNS:function(namespaceURI,localName){
		var attr = this.getNamedItemNS(namespaceURI,localName);
		_removeNamedNode(this._ownerElement,this,attr);
		return attr;
	},
	getNamedItemNS: function(namespaceURI, localName) {
		var i = this.length;
		while(i--){
			var node = this[i];
			if(node.localName == localName && node.namespaceURI == namespaceURI){
				return node;
			}
		}
		return null;
	}
};

/**
 * The DOMImplementation interface represents an object providing methods
 * which are not dependent on any particular document.
 * Such an object is returned by the `Document.implementation` property.
 *
 * __The individual methods describe the differences compared to the specs.__
 *
 * @constructor
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation MDN
 * @see https://www.w3.org/TR/REC-DOM-Level-1/level-one-core.html#ID-102161490 DOM Level 1 Core (Initial)
 * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#ID-102161490 DOM Level 2 Core
 * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#ID-102161490 DOM Level 3 Core
 * @see https://dom.spec.whatwg.org/#domimplementation DOM Living Standard
 */
function DOMImplementation() {
}

DOMImplementation.prototype = {
	/**
	 * The DOMImplementation.hasFeature() method returns a Boolean flag indicating if a given feature is supported.
	 * The different implementations fairly diverged in what kind of features were reported.
	 * The latest version of the spec settled to force this method to always return true, where the functionality was accurate and in use.
	 *
	 * @deprecated It is deprecated and modern browsers return true in all cases.
	 *
	 * @param {string} feature
	 * @param {string} [version]
	 * @returns {boolean} always true
	 *
	 * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/hasFeature MDN
	 * @see https://www.w3.org/TR/REC-DOM-Level-1/level-one-core.html#ID-5CED94D7 DOM Level 1 Core
	 * @see https://dom.spec.whatwg.org/#dom-domimplementation-hasfeature DOM Living Standard
	 */
	hasFeature: function(feature, version) {
			return true;
	},
	/**
	 * Creates an XML Document object of the specified type with its document element.
	 *
	 * __It behaves slightly different from the description in the living standard__:
	 * - There is no interface/class `XMLDocument`, it returns a `Document` instance.
	 * - `contentType`, `encoding`, `mode`, `origin`, `url` fields are currently not declared.
	 * - this implementation is not validating names or qualified names
	 *   (when parsing XML strings, the SAX parser takes care of that)
	 *
	 * @param {string|null} namespaceURI
	 * @param {string} qualifiedName
	 * @param {DocumentType=null} doctype
	 * @returns {Document}
	 *
	 * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/createDocument MDN
	 * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#Level-2-Core-DOM-createDocument DOM Level 2 Core (initial)
	 * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocument  DOM Level 2 Core
	 *
	 * @see https://dom.spec.whatwg.org/#validate-and-extract DOM: Validate and extract
	 * @see https://www.w3.org/TR/xml/#NT-NameStartChar XML Spec: Names
	 * @see https://www.w3.org/TR/xml-names/#ns-qualnames XML Namespaces: Qualified names
	 */
	createDocument: function(namespaceURI,  qualifiedName, doctype){
		var doc = new Document();
		doc.implementation = this;
		doc.childNodes = new NodeList();
		doc.doctype = doctype || null;
		if (doctype){
			doc.appendChild(doctype);
		}
		if (qualifiedName){
			var root = doc.createElementNS(namespaceURI, qualifiedName);
			doc.appendChild(root);
		}
		return doc;
	},
	/**
	 * Returns a doctype, with the given `qualifiedName`, `publicId`, and `systemId`.
	 *
	 * __This implementation differs from the specification:__
	 * - this implementation is not validating names or qualified names
	 *   (when parsing XML strings, the SAX parser takes care of that)
	 *
	 * Note: `internalSubset` can only be introduced via a direct property write to `node.internalSubset` after creation.
	 * Creation-time validation of `publicId`, `systemId` is not enforced.
	 * The serializer-level check covers all mutation vectors, including direct property writes.
	 * `internalSubset` is only serialized as `[ ... ]` when both `publicId` and `systemId` are
	 * absent (empty or `'.'`) — if either external identifier is present, `internalSubset` is
	 * silently omitted from the serialized output.
	 *
	 * @param {string} qualifiedName
	 * @param {string} [publicId]
	 * The external subset public identifier. Stored verbatim including surrounding quotes.
	 * When serialized with `requireWellFormed: true` (via the 4th-parameter options object),
	 * throws `DOMException` with code `INVALID_STATE_ERR` if the value is non-empty and does
	 * not match the XML `PubidLiteral` production (W3C DOM Parsing §3.2.1.3; XML 1.0 [12]).
	 * @param {string} [systemId]
	 * The external subset system identifier. Stored verbatim including surrounding quotes.
	 * When serialized with `requireWellFormed: true`, throws `DOMException` with code
	 * `INVALID_STATE_ERR` if the value is non-empty and does not match the XML `SystemLiteral`
	 * production (W3C DOM Parsing §3.2.1.3; XML 1.0 [11]).
	 * @returns {DocumentType} which can either be used with `DOMImplementation.createDocument` upon document creation
	 * 				  or can be put into the document via methods like `Node.insertBefore()` or `Node.replaceChild()`
	 *
	 * @see https://developer.mozilla.org/en-US/docs/Web/API/DOMImplementation/createDocumentType MDN
	 * @see https://www.w3.org/TR/DOM-Level-2-Core/core.html#Level-2-Core-DOM-createDocType DOM Level 2 Core
	 * @see https://dom.spec.whatwg.org/#dom-domimplementation-createdocumenttype DOM Living Standard
	 *
	 * @see https://dom.spec.whatwg.org/#validate-and-extract DOM: Validate and extract
	 * @see https://www.w3.org/TR/xml/#NT-NameStartChar XML Spec: Names
	 * @see https://www.w3.org/TR/xml-names/#ns-qualnames XML Namespaces: Qualified names
	 */
	createDocumentType: function(qualifiedName, publicId, systemId){
		var node = new DocumentType();
		node.name = qualifiedName;
		node.nodeName = qualifiedName;
		node.publicId = publicId || '';
		node.systemId = systemId || '';

		return node;
	}
};


/**
 * @see http://www.w3.org/TR/2000/REC-DOM-Level-2-Core-20001113/core.html#ID-1950641247
 */

function Node() {
};

Node.prototype = {
	firstChild : null,
	lastChild : null,
	previousSibling : null,
	nextSibling : null,
	attributes : null,
	parentNode : null,
	childNodes : null,
	ownerDocument : null,
	nodeValue : null,
	namespaceURI : null,
	prefix : null,
	localName : null,
	// Modified in DOM Level 2:
	insertBefore:function(newChild, refChild){//raises
		return _insertBefore(this,newChild,refChild);
	},
	replaceChild:function(newChild, oldChild){//raises
		_insertBefore(this, newChild,oldChild, assertPreReplacementValidityInDocument);
		if(oldChild){
			this.removeChild(oldChild);
		}
	},
	removeChild:function(oldChild){
		return _removeChild(this,oldChild);
	},
	appendChild:function(newChild){
		return this.insertBefore(newChild,null);
	},
	hasChildNodes:function(){
		return this.firstChild != null;
	},
	cloneNode:function(deep){
		return cloneNode(this.ownerDocument||this,this,deep);
	},
	// Modified in DOM Level 2:
	/**
	 * Puts the specified node and all of its subtree into a "normalized" form. In a normalized
	 * subtree, no text nodes in the subtree are empty and there are no adjacent text nodes.
	 *
	 * Specifically, this method merges any adjacent text nodes (i.e., nodes for which `nodeType`
	 * is `TEXT_NODE`) into a single node with the combined data. It also removes any empty text
	 * nodes.
	 *
	 * This method iteratively traverses all child nodes to normalize all descendant nodes within
	 * the subtree.
	 *
	 * @throws {DOMException}
	 * May throw a DOMException if operations within removeChild or appendData (which are
	 * potentially invoked in this method) do not meet their specific constraints.
	 * @see {@link Node.removeChild}
	 * @see {@link CharacterData.appendData}
	 * @see ../docs/walk-dom.md.
	 */
	normalize: function () {
		walkDOM(this, null, {
			enter: function (node) {
				// Merge adjacent text children of node before walkDOM schedules them.
				// walkDOM reads lastChild/previousSibling after enter returns, so the
				// surviving post-merge children are what it descends into.
				var child = node.firstChild;
				while (child) {
					var next = child.nextSibling;
					if (next !== null && next.nodeType === TEXT_NODE && child.nodeType === TEXT_NODE) {
						node.removeChild(next);
						child.appendData(next.data);
						// Do not advance child: re-check new nextSibling for another text run
					} else {
						child = next;
					}
				}
				return true; // descend into surviving children
			},
		});
	},
  	// Introduced in DOM Level 2:
	isSupported:function(feature, version){
		return this.ownerDocument.implementation.hasFeature(feature,version);
	},
    // Introduced in DOM Level 2:
    hasAttributes:function(){
    	return this.attributes.length>0;
    },
	/**
	 * Look up the prefix associated to the given namespace URI, starting from this node.
	 * **The default namespace declarations are ignored by this method.**
	 * See Namespace Prefix Lookup for details on the algorithm used by this method.
	 *
	 * _Note: The implementation seems to be incomplete when compared to the algorithm described in the specs._
	 *
	 * @param {string | null} namespaceURI
	 * @returns {string | null}
	 * @see https://www.w3.org/TR/DOM-Level-3-Core/core.html#Node3-lookupNamespacePrefix
	 * @see https://www.w3.org/TR/DOM-Level-3-Core/namespaces-algorithms.html#lookupNamespacePrefixAlgo
	 * @see https://dom.spec.whatwg.org/#dom-node-lookupprefix
	 * @see https://github.com/xmldom/xmldom/issues/322
	 */
    lookupPrefix:function(namespaceURI){
    	var el = this;
    	while(el){
    		var map = el._nsMap;
    		//console.dir(map)
    		if(map){
    			for(var n in map){
						if (Object.prototype.hasOwnProperty.call(map, n) && map[n] === namespaceURI) {
							return n;
						}
    			}
    		}
    		el = el.nodeType == ATTRIBUTE_NODE?el.ownerDocument : el.parentNode;
    	}
    	return null;
    },
    // Introduced in DOM Level 3:
    lookupNamespaceURI:function(prefix){
    	var el = this;
    	while(el){
    		var map = el._nsMap;
    		//console.dir(map)
    		if(map){
    			if(Object.prototype.hasOwnProperty.call(map, prefix)){
    				return map[prefix] ;
    			}
    		}
    		el = el.nodeType == ATTRIBUTE_NODE?el.ownerDocument : el.parentNode;
    	}
    	return null;
    },
    // Introduced in DOM Level 3:
    isDefaultNamespace:function(namespaceURI){
    	var prefix = this.lookupPrefix(namespaceURI);
    	return prefix == null;
    }
};


function _xmlEncoder(c){
	return c == '<' && '&lt;' ||
         c == '>' && '&gt;' ||
         c == '&' && '&amp;' ||
         c == '"' && '&quot;' ||
         '&#'+c.charCodeAt()+';'
}


copy(NodeType,Node);
copy(NodeType,Node.prototype);

/**
 * @param {Node} node
 * Root of the subtree to visit.
 * @param {function(Node): boolean} callback
 * Called for each node in depth-first pre-order. Return a truthy value to stop traversal early.
 * @return {boolean} `true` if traversal was aborted by the callback, `false` otherwise.
 */
function _visitNode(node, callback) {
	return walkDOM(node, null, { enter: function (n) { return callback(n) ? walkDOM.STOP : true; } }) === walkDOM.STOP;
}

/**
 * Depth-first pre/post-order DOM tree walker.
 *
 * Visits every node in the subtree rooted at `node`. For each node:
 *
 * 1. Calls `callbacks.enter(node, context)` before descending into the node's children. The
 * return value becomes the `context` passed to each child's `enter` call and to the matching
 * `exit` call.
 * 2. If `enter` returns `null` or `undefined`, the node's children are skipped;
 * sibling traversal continues normally.
 * 3. If `enter` returns `walkDOM.STOP`, the entire traversal is aborted immediately — no
 * further `enter` or `exit` calls are made.
 * 4. `lastChild` and `previousSibling` are read **after** `enter` returns, so `enter` may
 * safely modify the node's own child list before the walker descends. Modifying siblings of
 * the current node or any other part of the tree produces unpredictable results: nodes already
 * queued on the stack are visited regardless of DOM changes, and newly inserted nodes outside
 * the current child list are never visited.
 * 5. Calls `callbacks.exit(node, context)` (if provided) after all of a node's children have
 * been visited, passing the same `context` that `enter`
 * returned for that node.
 *
 * This implementation uses an explicit stack and does not recurse — it is safe on arbitrarily
 * deep trees.
 *
 * @param {Node} node
 * Root of the subtree to walk.
 * @param {*} context
 * Initial context value passed to the root node's `enter`.
 * @param {{ enter: function(Node, *): *, exit?: function(Node, *): void }} callbacks
 * @returns {void | walkDOM.STOP}
 * @see ../docs/walk-dom.md.
 */
function walkDOM(node, context, callbacks) {
	// Each stack frame is {node, context, phase}:
	//   walkDOM.ENTER — call enter, then push children
	//   walkDOM.EXIT  — call exit
	var stack = [{ node: node, context: context, phase: walkDOM.ENTER }];
	while (stack.length > 0) {
		var frame = stack.pop();
		if (frame.phase === walkDOM.ENTER) {
			var childContext = callbacks.enter(frame.node, frame.context);
			if (childContext === walkDOM.STOP) {
				return walkDOM.STOP;
			}
			// Push exit frame before children so it fires after all children are processed (Last In First Out)
			stack.push({ node: frame.node, context: childContext, phase: walkDOM.EXIT });
			if (childContext === null || childContext === undefined) {
				continue; // skip children
			}
			// lastChild is read after enter returns, so enter may modify the child list.
			var child = frame.node.lastChild;
			// Traverse from lastChild backwards so that pushing onto the stack
			// naturally yields firstChild on top (processed first).
			while (child) {
				stack.push({ node: child, context: childContext, phase: walkDOM.ENTER });
				child = child.previousSibling;
			}
		} else {
			// frame.phase === walkDOM.EXIT
			if (callbacks.exit) {
				callbacks.exit(frame.node, frame.context);
			}
		}
	}
}

/**
 * Sentinel value returned from a `walkDOM` `enter` callback to abort the entire traversal
 * immediately.
 *
 * @type {symbol}
 */
walkDOM.STOP = Symbol('walkDOM.STOP');
/**
 * Phase constant for a stack frame that has not yet been visited.
 * The `enter` callback is called and children are scheduled.
 *
 * @type {number}
 */
walkDOM.ENTER = 0;
/**
 * Phase constant for a stack frame whose subtree has been fully visited.
 * The `exit` callback is called.
 *
 * @type {number}
 */
walkDOM.EXIT = 1;

function Document(){
	this.ownerDocument = this;
}

function _onAddAttribute(doc,el,newAttr){
	doc && doc._inc++;
	var ns = newAttr.namespaceURI ;
	if(ns === NAMESPACE.XMLNS){
		//update namespace
		el._nsMap[newAttr.prefix?newAttr.localName:''] = newAttr.value
	}
}

function _onRemoveAttribute(doc,el,newAttr,remove){
	doc && doc._inc++;
	var ns = newAttr.namespaceURI ;
	if(ns === NAMESPACE.XMLNS){
		//update namespace
		delete el._nsMap[newAttr.prefix?newAttr.localName:'']
	}
}

/**
 * Updates `el.childNodes`, updating the indexed items and it's `length`.
 * Passing `newChild` means it will be appended.
 * Otherwise it's assumed that an item has been removed,
 * and `el.firstNode` and it's `.nextSibling` are used
 * to walk the current list of child nodes.
 *
 * @param {Document} doc
 * @param {Node} el
 * @param {Node} [newChild]
 * @private
 */
function _onUpdateChild (doc, el, newChild) {
	if(doc && doc._inc){
		doc._inc++;
		//update childNodes
		var cs = el.childNodes;
		if (newChild) {
			cs[cs.length++] = newChild;
		} else {
			var child = el.firstChild;
			var i = 0;
			while (child) {
				cs[i++] = child;
				child = child.nextSibling;
			}
			cs.length = i;
			delete cs[cs.length];
		}
	}
}

/**
 * Removes the connections between `parentNode` and `child`
 * and any existing `child.previousSibling` or `child.nextSibling`.
 *
 * @see https://github.com/xmldom/xmldom/issues/135
 * @see https://github.com/xmldom/xmldom/issues/145
 *
 * @param {Node} parentNode
 * @param {Node} child
 * @returns {Node} the child that was removed.
 * @private
 */
function _removeChild (parentNode, child) {
	var previous = child.previousSibling;
	var next = child.nextSibling;
	if (previous) {
		previous.nextSibling = next;
	} else {
		parentNode.firstChild = next;
	}
	if (next) {
		next.previousSibling = previous;
	} else {
		parentNode.lastChild = previous;
	}
	child.parentNode = null;
	child.previousSibling = null;
	child.nextSibling = null;
	_onUpdateChild(parentNode.ownerDocument, parentNode);
	return child;
}

/**
 * Returns `true` if `node` can be a parent for insertion.
 * @param {Node} node
 * @returns {boolean}
 */
function hasValidParentNodeType(node) {
	return (
		node &&
		(node.nodeType === Node.DOCUMENT_NODE || node.nodeType === Node.DOCUMENT_FRAGMENT_NODE || node.nodeType === Node.ELEMENT_NODE)
	);
}

/**
 * Returns `true` if `node` can be inserted according to it's `nodeType`.
 * @param {Node} node
 * @returns {boolean}
 */
function hasInsertableNodeType(node) {
	return (
		node &&
		(isElementNode(node) ||
			isTextNode(node) ||
			isDocTypeNode(node) ||
			node.nodeType === Node.DOCUMENT_FRAGMENT_NODE ||
			node.nodeType === Node.COMMENT_NODE ||
			node.nodeType === Node.PROCESSING_INSTRUCTION_NODE)
	);
}

/**
 * Returns true if `node` is a DOCTYPE node
 * @param {Node} node
 * @returns {boolean}
 */
function isDocTypeNode(node) {
	return node && node.nodeType === Node.DOCUMENT_TYPE_NODE;
}

/**
 * Returns true if the node is an element
 * @param {Node} node
 * @returns {boolean}
 */
function isElementNode(node) {
	return node && node.nodeType === Node.ELEMENT_NODE;
}
/**
 * Returns true if `node` is a text node
 * @param {Node} node
 * @returns {boolean}
 */
function isTextNode(node) {
	return node && node.nodeType === Node.TEXT_NODE;
}

/**
 * Check if en element node can be inserted before `child`, or at the end if child is falsy,
 * according to the presence and position of a doctype node on the same level.
 *
 * @param {Document} doc The document node
 * @param {Node} child the node that would become the nextSibling if the element would be inserted
 * @returns {boolean} `true` if an element can be inserted before child
 * @private
 * https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity
 */
function isElementInsertionPossible(doc, child) {
	var parentChildNodes = doc.childNodes || [];
	if (find(parentChildNodes, isElementNode) || isDocTypeNode(child)) {
		return false;
	}
	var docTypeNode = find(parentChildNodes, isDocTypeNode);
	return !(child && docTypeNode && parentChildNodes.indexOf(docTypeNode) > parentChildNodes.indexOf(child));
}

/**
 * Check if en element node can be inserted before `child`, or at the end if child is falsy,
 * according to the presence and position of a doctype node on the same level.
 *
 * @param {Node} doc The document node
 * @param {Node} child the node that would become the nextSibling if the element would be inserted
 * @returns {boolean} `true` if an element can be inserted before child
 * @private
 * https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity
 */
function isElementReplacementPossible(doc, child) {
	var parentChildNodes = doc.childNodes || [];

	function hasElementChildThatIsNotChild(node) {
		return isElementNode(node) && node !== child;
	}

	if (find(parentChildNodes, hasElementChildThatIsNotChild)) {
		return false;
	}
	var docTypeNode = find(parentChildNodes, isDocTypeNode);
	return !(child && docTypeNode && parentChildNodes.indexOf(docTypeNode) > parentChildNodes.indexOf(child));
}

/**
 * @private
 * Steps 1-5 of the checks before inserting and before replacing a child are the same.
 *
 * @param {Node} parent the parent node to insert `node` into
 * @param {Node} node the node to insert
 * @param {Node=} child the node that should become the `nextSibling` of `node`
 * @returns {Node}
 * @throws DOMException for several node combinations that would create a DOM that is not well-formed.
 * @throws DOMException if `child` is provided but is not a child of `parent`.
 * @see https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity
 * @see https://dom.spec.whatwg.org/#concept-node-replace
 */
function assertPreInsertionValidity1to5(parent, node, child) {
	// 1. If `parent` is not a Document, DocumentFragment, or Element node, then throw a "HierarchyRequestError" DOMException.
	if (!hasValidParentNodeType(parent)) {
		throw new DOMException(HIERARCHY_REQUEST_ERR, 'Unexpected parent node type ' + parent.nodeType);
	}
	// 2. If `node` is a host-including inclusive ancestor of `parent`, then throw a "HierarchyRequestError" DOMException.
	// not implemented!
	// 3. If `child` is non-null and its parent is not `parent`, then throw a "NotFoundError" DOMException.
	if (child && child.parentNode !== parent) {
		throw new DOMException(NOT_FOUND_ERR, 'child not in parent');
	}
	if (
		// 4. If `node` is not a DocumentFragment, DocumentType, Element, or CharacterData node, then throw a "HierarchyRequestError" DOMException.
		!hasInsertableNodeType(node) ||
		// 5. If either `node` is a Text node and `parent` is a document,
		// the sax parser currently adds top level text nodes, this will be fixed in 0.9.0
		// || (node.nodeType === Node.TEXT_NODE && parent.nodeType === Node.DOCUMENT_NODE)
		// or `node` is a doctype and `parent` is not a document, then throw a "HierarchyRequestError" DOMException.
		(isDocTypeNode(node) && parent.nodeType !== Node.DOCUMENT_NODE)
	) {
		throw new DOMException(
			HIERARCHY_REQUEST_ERR,
			'Unexpected node type ' + node.nodeType + ' for parent node type ' + parent.nodeType
		);
	}
}

/**
 * @private
 * Step 6 of the checks before inserting and before replacing a child are different.
 *
 * @param {Document} parent the parent node to insert `node` into
 * @param {Node} node the node to insert
 * @param {Node | undefined} child the node that should become the `nextSibling` of `node`
 * @returns {Node}
 * @throws DOMException for several node combinations that would create a DOM that is not well-formed.
 * @throws DOMException if `child` is provided but is not a child of `parent`.
 * @see https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity
 * @see https://dom.spec.whatwg.org/#concept-node-replace
 */
function assertPreInsertionValidityInDocument(parent, node, child) {
	var parentChildNodes = parent.childNodes || [];
	var nodeChildNodes = node.childNodes || [];

	// DocumentFragment
	if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
		var nodeChildElements = nodeChildNodes.filter(isElementNode);
		// If node has more than one element child or has a Text node child.
		if (nodeChildElements.length > 1 || find(nodeChildNodes, isTextNode)) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'More than one element or text in fragment');
		}
		// Otherwise, if `node` has one element child and either `parent` has an element child,
		// `child` is a doctype, or `child` is non-null and a doctype is following `child`.
		if (nodeChildElements.length === 1 && !isElementInsertionPossible(parent, child)) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'Element in fragment can not be inserted before doctype');
		}
	}
	// Element
	if (isElementNode(node)) {
		// `parent` has an element child, `child` is a doctype,
		// or `child` is non-null and a doctype is following `child`.
		if (!isElementInsertionPossible(parent, child)) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'Only one element can be added and only after doctype');
		}
	}
	// DocumentType
	if (isDocTypeNode(node)) {
		// `parent` has a doctype child,
		if (find(parentChildNodes, isDocTypeNode)) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'Only one doctype is allowed');
		}
		var parentElementChild = find(parentChildNodes, isElementNode);
		// `child` is non-null and an element is preceding `child`,
		if (child && parentChildNodes.indexOf(parentElementChild) < parentChildNodes.indexOf(child)) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'Doctype can only be inserted before an element');
		}
		// or `child` is null and `parent` has an element child.
		if (!child && parentElementChild) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'Doctype can not be appended since element is present');
		}
	}
}

/**
 * @private
 * Step 6 of the checks before inserting and before replacing a child are different.
 *
 * @param {Document} parent the parent node to insert `node` into
 * @param {Node} node the node to insert
 * @param {Node | undefined} child the node that should become the `nextSibling` of `node`
 * @returns {Node}
 * @throws DOMException for several node combinations that would create a DOM that is not well-formed.
 * @throws DOMException if `child` is provided but is not a child of `parent`.
 * @see https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity
 * @see https://dom.spec.whatwg.org/#concept-node-replace
 */
function assertPreReplacementValidityInDocument(parent, node, child) {
	var parentChildNodes = parent.childNodes || [];
	var nodeChildNodes = node.childNodes || [];

	// DocumentFragment
	if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
		var nodeChildElements = nodeChildNodes.filter(isElementNode);
		// If `node` has more than one element child or has a Text node child.
		if (nodeChildElements.length > 1 || find(nodeChildNodes, isTextNode)) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'More than one element or text in fragment');
		}
		// Otherwise, if `node` has one element child and either `parent` has an element child that is not `child` or a doctype is following `child`.
		if (nodeChildElements.length === 1 && !isElementReplacementPossible(parent, child)) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'Element in fragment can not be inserted before doctype');
		}
	}
	// Element
	if (isElementNode(node)) {
		// `parent` has an element child that is not `child` or a doctype is following `child`.
		if (!isElementReplacementPossible(parent, child)) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'Only one element can be added and only after doctype');
		}
	}
	// DocumentType
	if (isDocTypeNode(node)) {
		function hasDoctypeChildThatIsNotChild(node) {
			return isDocTypeNode(node) && node !== child;
		}

		// `parent` has a doctype child that is not `child`,
		if (find(parentChildNodes, hasDoctypeChildThatIsNotChild)) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'Only one doctype is allowed');
		}
		var parentElementChild = find(parentChildNodes, isElementNode);
		// or an element is preceding `child`.
		if (child && parentChildNodes.indexOf(parentElementChild) < parentChildNodes.indexOf(child)) {
			throw new DOMException(HIERARCHY_REQUEST_ERR, 'Doctype can only be inserted before an element');
		}
	}
}

/**
 * @private
 * @param {Node} parent the parent node to insert `node` into
 * @param {Node} node the node to insert
 * @param {Node=} child the node that should become the `nextSibling` of `node`
 * @returns {Node}
 * @throws DOMException for several node combinations that would create a DOM that is not well-formed.
 * @throws DOMException if `child` is provided but is not a child of `parent`.
 * @see https://dom.spec.whatwg.org/#concept-node-ensure-pre-insertion-validity
 */
function _insertBefore(parent, node, child, _inDocumentAssertion) {
	// To ensure pre-insertion validity of a node into a parent before a child, run these steps:
	assertPreInsertionValidity1to5(parent, node, child);

	// If parent is a document, and any of the statements below, switched on the interface node implements,
	// are true, then throw a "HierarchyRequestError" DOMException.
	if (parent.nodeType === Node.DOCUMENT_NODE) {
		(_inDocumentAssertion || assertPreInsertionValidityInDocument)(parent, node, child);
	}

	var cp = node.parentNode;
	if(cp){
		cp.removeChild(node);//remove and update
	}
	if(node.nodeType === DOCUMENT_FRAGMENT_NODE){
		var newFirst = node.firstChild;
		if (newFirst == null) {
			return node;
		}
		var newLast = node.lastChild;
	}else{
		newFirst = newLast = node;
	}
	var pre = child ? child.previousSibling : parent.lastChild;

	newFirst.previousSibling = pre;
	newLast.nextSibling = child;


	if(pre){
		pre.nextSibling = newFirst;
	}else{
		parent.firstChild = newFirst;
	}
	if(child == null){
		parent.lastChild = newLast;
	}else{
		child.previousSibling = newLast;
	}
	do{
		newFirst.parentNode = parent;
		// Update ownerDocument for each node being inserted
		var targetDoc = parent.ownerDocument || parent;
		_updateOwnerDocument(newFirst, targetDoc);
	}while(newFirst !== newLast && (newFirst= newFirst.nextSibling))
	_onUpdateChild(parent.ownerDocument||parent, parent);
	//console.log(parent.lastChild.nextSibling == null)
	if (node.nodeType == DOCUMENT_FRAGMENT_NODE) {
		node.firstChild = node.lastChild = null;
	}
	return node;
}

/**
 * Recursively updates the ownerDocument property for a node and all its descendants
 * @param {Node} node
 * @param {Document} newOwnerDocument
 * @private
 */
function _updateOwnerDocument(node, newOwnerDocument) {
	if (node.ownerDocument === newOwnerDocument) {
		return;
	}
	
	node.ownerDocument = newOwnerDocument;
	
	// Update attributes if this is an element
	if (node.nodeType === ELEMENT_NODE && node.attributes) {
		for (var i = 0; i < node.attributes.length; i++) {
			var attr = node.attributes.item(i);
			if (attr) {
				attr.ownerDocument = newOwnerDocument;
			}
		}
	}
	
	// Recursively update child nodes
	var child = node.firstChild;
	while (child) {
		_updateOwnerDocument(child, newOwnerDocument);
		child = child.nextSibling;
	}
}

/**
 * Appends `newChild` to `parentNode`.
 * If `newChild` is already connected to a `parentNode` it is first removed from it.
 *
 * @see https://github.com/xmldom/xmldom/issues/135
 * @see https://github.com/xmldom/xmldom/issues/145
 * @param {Node} parentNode
 * @param {Node} newChild
 * @returns {Node}
 * @private
 */
function _appendSingleChild (parentNode, newChild) {
	if (newChild.parentNode) {
		newChild.parentNode.removeChild(newChild);
	}
	newChild.parentNode = parentNode;
	newChild.previousSibling = parentNode.lastChild;
	newChild.nextSibling = null;
	if (newChild.previousSibling) {
		newChild.previousSibling.nextSibling = newChild;
	} else {
		parentNode.firstChild = newChild;
	}
	parentNode.lastChild = newChild;
	_onUpdateChild(parentNode.ownerDocument, parentNode, newChild);
	
	// Update ownerDocument for the new child and all its descendants
	var targetDoc = parentNode.ownerDocument || parentNode;
	_updateOwnerDocument(newChild, targetDoc);
	
	return newChild;
}

Document.prototype = {
	//implementation : null,
	nodeName :  '#document',
	nodeType :  DOCUMENT_NODE,
	/**
	 * The DocumentType node of the document.
	 *
	 * @readonly
	 * @type DocumentType
	 */
	doctype :  null,
	documentElement :  null,
	_inc : 1,

	insertBefore :  function(newChild, refChild){//raises
		if(newChild.nodeType == DOCUMENT_FRAGMENT_NODE){
			var child = newChild.firstChild;
			while(child){
				var next = child.nextSibling;
				this.insertBefore(child,refChild);
				child = next;
			}
			return newChild;
		}
		_insertBefore(this, newChild, refChild);
		_updateOwnerDocument(newChild, this);
		if (this.documentElement === null && newChild.nodeType === ELEMENT_NODE) {
			this.documentElement = newChild;
		}

		return newChild;
	},
	removeChild :  function(oldChild){
		if(this.documentElement == oldChild){
			this.documentElement = null;
		}
		return _removeChild(this,oldChild);
	},
	replaceChild: function (newChild, oldChild) {
		//raises
		_insertBefore(this, newChild, oldChild, assertPreReplacementValidityInDocument);
		_updateOwnerDocument(newChild, this);
		if (oldChild) {
			this.removeChild(oldChild);
		}
		if (isElementNode(newChild)) {
			this.documentElement = newChild;
		}
	},
	// Introduced in DOM Level 2:
	importNode : function(importedNode,deep){
		return importNode(this,importedNode,deep);
	},
	// Introduced in DOM Level 2:
	getElementById :	function(id){
		var rtv = null;
		_visitNode(this.documentElement,function(node){
			if(node.nodeType == ELEMENT_NODE){
				if(node.getAttribute('id') == id){
					rtv = node;
					return true;
				}
			}
		})
		return rtv;
	},

	/**
	 * The `getElementsByClassName` method of `Document` interface returns an array-like object
	 * of all child elements which have **all** of the given class name(s).
	 *
	 * Returns an empty list if `classeNames` is an empty string or only contains HTML white space characters.
	 *
	 *
	 * Warning: This is a live LiveNodeList.
	 * Changes in the DOM will reflect in the array as the changes occur.
	 * If an element selected by this array no longer qualifies for the selector,
	 * it will automatically be removed. Be aware of this for iteration purposes.
	 *
	 * @param {string} classNames is a string representing the class name(s) to match; multiple class names are separated by (ASCII-)whitespace
	 *
	 * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/getElementsByClassName
	 * @see https://dom.spec.whatwg.org/#concept-getelementsbyclassname
	 */
	getElementsByClassName: function(classNames) {
		var classNamesSet = toOrderedSet(classNames)
		return new LiveNodeList(this, function(base) {
			var ls = [];
			if (classNamesSet.length > 0) {
				_visitNode(base.documentElement, function(node) {
					if(node !== base && node.nodeType === ELEMENT_NODE) {
						var nodeClassNames = node.getAttribute('class')
						// can be null if the attribute does not exist
						if (nodeClassNames) {
							// before splitting and iterating just compare them for the most common case
							var matches = classNames === nodeClassNames;
							if (!matches) {
								var nodeClassNamesSet = toOrderedSet(nodeClassNames)
								matches = classNamesSet.every(arrayIncludes(nodeClassNamesSet))
							}
							if(matches) {
								ls.push(node);
							}
						}
					}
				});
			}
			return ls;
		});
	},

	//document factory method:
	createElement :	function(tagName){
		var node = new Element();
		node.ownerDocument = this;
		node.nodeName = tagName;
		node.tagName = tagName;
		node.localName = tagName;
		node.childNodes = new NodeList();
		var attrs	= node.attributes = new NamedNodeMap();
		attrs._ownerElement = node;
		return node;
	},
	createDocumentFragment :	function(){
		var node = new DocumentFragment();
		node.ownerDocument = this;
		node.childNodes = new NodeList();
		return node;
	},
	createTextNode :	function(data){
		var node = new Text();
		node.ownerDocument = this;
		node.appendData(data)
		return node;
	},
	createComment :	function(data){
		var node = new Comment();
		node.ownerDocument = this;
		node.appendData(data)
		return node;
	},
	/**
	 * Returns a new CDATASection node whose data is `data`.
	 *
	 * __This implementation differs from the specification:__
	 * - calling this method on an HTML document does not throw `NotSupportedError`.
	 *
	 * @param {string} data
	 * @returns {CDATASection}
	 * @throws DOMException with code `INVALID_CHARACTER_ERR` if `data` contains `"]]>"`.
	 * @see https://developer.mozilla.org/en-US/docs/Web/API/Document/createCDATASection
	 * @see https://dom.spec.whatwg.org/#dom-document-createcdatasection
	 */
	createCDATASection :	function(data){
		if (data.indexOf(']]>') !== -1) {
			throw new DOMException(INVALID_CHARACTER_ERR, 'data contains "]]>"');
		}
		var node = new CDATASection();
		node.ownerDocument = this;
		node.appendData(data)
		return node;
	},
	/**
	 * Returns a ProcessingInstruction node whose target is target and data is data.
	 *
	 * __This implementation differs from the specification:__
	 * - it does not do any input validation on the arguments and doesn't throw "InvalidCharacterError".
	 *
	 * Note: When the resulting document is serialized with `requireWellFormed: true`, the
	 * serializer throws with code `INVALID_STATE_ERR` if `.data` contains `?>` (W3C DOM Parsing
	 * §3.2.1.7). Without that option the data is emitted verbatim.
	 *
	 * @param {string} target
	 * @param {string} data
	 * @returns {ProcessingInstruction}
	 * @see https://developer.mozilla.org/docs/Web/API/Document/createProcessingInstruction
	 * @see https://dom.spec.whatwg.org/#dom-document-createprocessinginstruction
	 * @see https://www.w3.org/TR/DOM-Parsing/#dfn-concept-serialize-xml §3.2.1.7
	 */
	createProcessingInstruction :	function(target,data){
		var node = new ProcessingInstruction();
		node.ownerDocument = this;
		node.tagName = node.nodeName = node.target = target;
		node.nodeValue = node.data = data;
		return node;
	},
	createAttribute :	function(name){
		var node = new Attr();
		node.ownerDocument	= this;
		node.name = name;
		node.nodeName	= name;
		node.localName = name;
		node.specified = true;
		return node;
	},
	createEntityReference :	function(name){
		var node = new EntityReference();
		node.ownerDocument	= this;
		node.nodeName	= name;
		return node;
	},
	// Introduced in DOM Level 2:
	createElementNS :	function(namespaceURI,qualifiedName){
		var node = new Element();
		var pl = qualifiedName.split(':');
		var attrs	= node.attributes = new NamedNodeMap();
		node.childNodes = new NodeList();
		node.ownerDocument = this;
		node.nodeName = qualifiedName;
		node.tagName = qualifiedName;
		node.namespaceURI = namespaceURI;
		if(pl.length == 2){
			node.prefix = pl[0];
			node.localName = pl[1];
		}else{
			//el.prefix = null;
			node.localName = qualifiedName;
		}
		attrs._ownerElement = node;
		return node;
	},
	// Introduced in DOM Level 2:
	createAttributeNS :	function(namespaceURI,qualifiedName){
		var node = new Attr();
		var pl = qualifiedName.split(':');
		node.ownerDocument = this;
		node.nodeName = qualifiedName;
		node.name = qualifiedName;
		node.namespaceURI = namespaceURI;
		node.specified = true;
		if(pl.length == 2){
			node.prefix = pl[0];
			node.localName = pl[1];
		}else{
			//el.prefix = null;
			node.localName = qualifiedName;
		}
		return node;
	}
};
_extends(Document,Node);


function Element() {
	this._nsMap = {};
};
Element.prototype = {
	nodeType : ELEMENT_NODE,
	hasAttribute : function(name){
		return this.getAttributeNode(name)!=null;
	},
	getAttribute : function(name){
		var attr = this.getAttributeNode(name);
		return attr && attr.value || '';
	},
	getAttributeNode : function(name){
		return this.attributes.getNamedItem(name);
	},
	setAttribute : function(name, value){
		var attr = this.ownerDocument.createAttribute(name);
		attr.value = attr.nodeValue = "" + value;
		this.setAttributeNode(attr)
	},
	removeAttribute : function(name){
		var attr = this.getAttributeNode(name)
		attr && this.removeAttributeNode(attr);
	},

	//four real opeartion method
	appendChild:function(newChild){
		if(newChild.nodeType === DOCUMENT_FRAGMENT_NODE){
			return this.insertBefore(newChild,null);
		}else{
			return _appendSingleChild(this,newChild);
		}
	},
	setAttributeNode : function(newAttr){
		return this.attributes.setNamedItem(newAttr);
	},
	setAttributeNodeNS : function(newAttr){
		return this.attributes.setNamedItemNS(newAttr);
	},
	removeAttributeNode : function(oldAttr){
		//console.log(this == oldAttr.ownerElement)
		return this.attributes.removeNamedItem(oldAttr.nodeName);
	},
	//get real attribute name,and remove it by removeAttributeNode
	removeAttributeNS : function(namespaceURI, localName){
		var old = this.getAttributeNodeNS(namespaceURI, localName);
		old && this.removeAttributeNode(old);
	},

	hasAttributeNS : function(namespaceURI, localName){
		return this.getAttributeNodeNS(namespaceURI, localName)!=null;
	},
	getAttributeNS : function(namespaceURI, localName){
		var attr = this.getAttributeNodeNS(namespaceURI, localName);
		return attr && attr.value || '';
	},
	setAttributeNS : function(namespaceURI, qualifiedName, value){
		var attr = this.ownerDocument.createAttributeNS(namespaceURI, qualifiedName);
		attr.value = attr.nodeValue = "" + value;
		this.setAttributeNode(attr)
	},
	getAttributeNodeNS : function(namespaceURI, localName){
		return this.attributes.getNamedItemNS(namespaceURI, localName);
	},

	getElementsByTagName : function(tagName){
		return new LiveNodeList(this,function(base){
			var ls = [];
			_visitNode(base,function(node){
				if(node !== base && node.nodeType == ELEMENT_NODE && (tagName === '*' || node.tagName == tagName)){
					ls.push(node);
				}
			});
			return ls;
		});
	},
	getElementsByTagNameNS : function(namespaceURI, localName){
		return new LiveNodeList(this,function(base){
			var ls = [];
			_visitNode(base,function(node){
				if(node !== base && node.nodeType === ELEMENT_NODE && (namespaceURI === '*' || node.namespaceURI === namespaceURI) && (localName === '*' || node.localName == localName)){
					ls.push(node);
				}
			});
			return ls;

		});
	}
};
Document.prototype.getElementsByTagName = Element.prototype.getElementsByTagName;
Document.prototype.getElementsByTagNameNS = Element.prototype.getElementsByTagNameNS;


_extends(Element,Node);
function Attr() {
};
Attr.prototype.nodeType = ATTRIBUTE_NODE;
_extends(Attr,Node);


function CharacterData() {
};
CharacterData.prototype = {
	data : '',
	substringData : function(offset, count) {
		return this.data.substring(offset, offset+count);
	},
	appendData: function(text) {
		text = this.data+text;
		this.nodeValue = this.data = text;
		this.length = text.length;
	},
	insertData: function(offset,text) {
		this.replaceData(offset,0,text);

	},
	appendChild:function(newChild){
		throw new Error(ExceptionMessage[HIERARCHY_REQUEST_ERR])
	},
	deleteData: function(offset, count) {
		this.replaceData(offset,count,"");
	},
	replaceData: function(offset, count, text) {
		var start = this.data.substring(0,offset);
		var end = this.data.substring(offset+count);
		text = start + text + end;
		this.nodeValue = this.data = text;
		this.length = text.length;
	}
}
_extends(CharacterData,Node);
function Text() {
};
Text.prototype = {
	nodeName : "#text",
	nodeType : TEXT_NODE,
	splitText : function(offset) {
		var text = this.data;
		var newText = text.substring(offset);
		text = text.substring(0, offset);
		this.data = this.nodeValue = text;
		this.length = text.length;
		var newNode = this.ownerDocument.createTextNode(newText);
		if(this.parentNode){
			this.parentNode.insertBefore(newNode, this.nextSibling);
		}
		return newNode;
	}
}
_extends(Text,CharacterData);
function Comment() {
};
Comment.prototype = {
	nodeName : "#comment",
	nodeType : COMMENT_NODE
}
_extends(Comment,CharacterData);

function CDATASection() {
};
CDATASection.prototype = {
	nodeName : "#cdata-section",
	nodeType : CDATA_SECTION_NODE
}
_extends(CDATASection,CharacterData);


/**
 * Represents a DocumentType node (the `<!DOCTYPE ...>` declaration).
 *
 * `publicId`, `systemId`, and `internalSubset` are plain own-property assignments.
 * xmldom does not enforce the `readonly` constraint declared by the WHATWG DOM spec —
 * direct property writes succeed silently. Values are serialized verbatim when
 * `requireWellFormed` is false (the default). When the serializer is invoked with
 * `requireWellFormed: true` (via the 4th-parameter options object), it validates each
 * field and throws `DOMException` with code `INVALID_STATE_ERR` on invalid values.
 *
 * @class
 * @see https://developer.mozilla.org/en-US/docs/Web/API/DocumentType MDN
 */
function DocumentType() {
};
DocumentType.prototype.nodeType = DOCUMENT_TYPE_NODE;
_extends(DocumentType,Node);

function Notation() {
};
Notation.prototype.nodeType = NOTATION_NODE;
_extends(Notation,Node);

function Entity() {
};
Entity.prototype.nodeType = ENTITY_NODE;
_extends(Entity,Node);

function EntityReference() {
};
EntityReference.prototype.nodeType = ENTITY_REFERENCE_NODE;
_extends(EntityReference,Node);

function DocumentFragment() {
};
DocumentFragment.prototype.nodeName =	"#document-fragment";
DocumentFragment.prototype.nodeType =	DOCUMENT_FRAGMENT_NODE;
_extends(DocumentFragment,Node);


function ProcessingInstruction() {
}
ProcessingInstruction.prototype.nodeType = PROCESSING_INSTRUCTION_NODE;
_extends(ProcessingInstruction,Node);
function XMLSerializer(){}
/**
 * Returns the result of serializing `node` to XML.
 *
 * When `options.requireWellFormed` is `true`, the serializer throws for content that would
 * produce ill-formed XML.
 *
 * __This implementation differs from the specification:__
 * - CDATASection nodes whose data contains `]]>` are serialized by splitting the section
 *   at each `]]>` occurrence (following W3C DOM Level 3 Core `split-cdata-sections`
 *   default behaviour) unless `requireWellFormed` is `true`.
 * - when `requireWellFormed` is `true`, `DOMException` with code `INVALID_STATE_ERR`
 *   is only thrown to prevent injection vectors, not for all the spec mandated checks.
 *
 * @param {Node} node
 * @param {boolean} [isHtml]
 * @param {function} [nodeFilter]
 * @param {Object} [options]
 * @param {boolean} [options.requireWellFormed=false]
 * When `true`, throws for content that would produce ill-formed XML.
 * @returns {string}
 * @throws {DOMException}
 * With code `INVALID_STATE_ERR` when `requireWellFormed` is `true` and:
 * - a CDATASection node's data contains `"]]>"`,
 * - a Comment node's data contains `"-->"` (bare `"--"` does not throw on this branch),
 * - a ProcessingInstruction's data contains `"?>"`,
 * - a DocumentType's `publicId` is non-empty and does not match the XML `PubidLiteral`
 *   production,
 * - a DocumentType's `systemId` is non-empty and does not match the XML `SystemLiteral`
 *   production, or
 * - a DocumentType's `internalSubset` contains `"]>"`.
 * Note: xmldom does not enforce `readonly` on DocumentType fields — direct property
 * writes succeed and are covered by the serializer-level checks above.
 * @see https://html.spec.whatwg.org/#dom-xmlserializer-serializetostring
 * @see https://w3c.github.io/DOM-Parsing/#xml-serialization
 * @see https://github.com/w3c/DOM-Parsing/issues/84
 */
XMLSerializer.prototype.serializeToString = function(node,isHtml,nodeFilter,options){
	return nodeSerializeToString.call(node,isHtml,nodeFilter,options);
}
Node.prototype.toString = nodeSerializeToString;
function nodeSerializeToString(isHtml,nodeFilter,options){
	var requireWellFormed = !!options && !!options.requireWellFormed;
	var buf = [];
	var refNode = this.nodeType == 9 && this.documentElement || this;
	var prefix = refNode.prefix;
	var uri = refNode.namespaceURI;

	if(uri && prefix == null){
		//console.log(prefix)
		var prefix = refNode.lookupPrefix(uri);
		if(prefix == null){
			//isHTML = true;
			var visibleNamespaces=[
			{namespace:uri,prefix:null}
			//{namespace:uri,prefix:''}
			]
		}
	}
	serializeToString(this,buf,isHtml,nodeFilter,visibleNamespaces,requireWellFormed);
	//console.log('###',this.nodeType,uri,prefix,buf.join(''))
	return buf.join('');
}

function needNamespaceDefine(node, isHTML, visibleNamespaces) {
	var prefix = node.prefix || '';
	var uri = node.namespaceURI;
	// According to [Namespaces in XML 1.0](https://www.w3.org/TR/REC-xml-names/#ns-using) ,
	// and more specifically https://www.w3.org/TR/REC-xml-names/#nsc-NoPrefixUndecl :
	// > In a namespace declaration for a prefix [...], the attribute value MUST NOT be empty.
	// in a similar manner [Namespaces in XML 1.1](https://www.w3.org/TR/xml-names11/#ns-using)
	// and more specifically https://www.w3.org/TR/xml-names11/#nsc-NSDeclared :
	// > [...] Furthermore, the attribute value [...] must not be an empty string.
	// so serializing empty namespace value like xmlns:ds="" would produce an invalid XML document.
	if (!uri) {
		return false;
	}
	if (prefix === "xml" && uri === NAMESPACE.XML || uri === NAMESPACE.XMLNS) {
		return false;
	}

	var i = visibleNamespaces.length
	while (i--) {
		var ns = visibleNamespaces[i];
		// get namespace prefix
		if (ns.prefix === prefix) {
			return ns.namespace !== uri;
		}
	}
	return true;
}
/**
 * Well-formed constraint: No < in Attribute Values
 * > The replacement text of any entity referred to directly or indirectly
 * > in an attribute value must not contain a <.
 * @see https://www.w3.org/TR/xml11/#CleanAttrVals
 * @see https://www.w3.org/TR/xml11/#NT-AttValue
 *
 * Literal whitespace other than space that appear in attribute values
 * are serialized as their entity references, so they will be preserved.
 * (In contrast to whitespace literals in the input which are normalized to spaces)
 * @see https://www.w3.org/TR/xml11/#AVNormalize
 * @see https://w3c.github.io/DOM-Parsing/#serializing-an-element-s-attributes
 */
function addSerializedAttribute(buf, qualifiedName, value) {
	buf.push(' ', qualifiedName, '="', value.replace(/[<>&"\t\n\r]/g, _xmlEncoder), '"')
}

function serializeToString(node, buf, isHTML, nodeFilter, visibleNamespaces, requireWellFormed) {
	if (!visibleNamespaces) {
		visibleNamespaces = [];
	}
	walkDOM(node, { ns: visibleNamespaces, isHTML: isHTML }, {
		enter: function (n, ctx) {
			var ns = ctx.ns;
			var html = ctx.isHTML;

			if (nodeFilter) {
				n = nodeFilter(n);
				if (n) {
					if (typeof n == 'string') {
						buf.push(n);
						return null;
					}
				} else {
					return null;
				}
			}

			switch (n.nodeType) {
				case ELEMENT_NODE:
					var attrs = n.attributes;
					var len = attrs.length;
					var nodeName = n.tagName;

					html = NAMESPACE.isHTML(n.namespaceURI) || html;

					var prefixedNodeName = nodeName;
					if (!html && !n.prefix && n.namespaceURI) {
						var defaultNS;
						// lookup current default ns from `xmlns` attribute
						for (var ai = 0; ai < attrs.length; ai++) {
							if (attrs.item(ai).name === 'xmlns') {
								defaultNS = attrs.item(ai).value;
								break;
							}
						}
						if (!defaultNS) {
							// lookup current default ns in visibleNamespaces
							for (var nsi = ns.length - 1; nsi >= 0; nsi--) {
								var nsEntry = ns[nsi];
								if (nsEntry.prefix === '' && nsEntry.namespace === n.namespaceURI) {
									defaultNS = nsEntry.namespace;
									break;
								}
							}
						}
						if (defaultNS !== n.namespaceURI) {
							for (var nsi = ns.length - 1; nsi >= 0; nsi--) {
								var nsEntry = ns[nsi];
								if (nsEntry.namespace === n.namespaceURI) {
									if (nsEntry.prefix) {
										prefixedNodeName = nsEntry.prefix + ':' + nodeName;
									}
									break;
								}
							}
						}
					}

					buf.push('<', prefixedNodeName);

					// Build a fresh namespace snapshot for this element's children.
					// The slice prevents sibling elements from inheriting each other's declarations.
					var childNs = ns.slice();
					for (var i = 0; i < len; i++) {
						var attr = attrs.item(i);
						if (attr.prefix == 'xmlns') {
							childNs.push({ prefix: attr.localName, namespace: attr.value });
						} else if (attr.nodeName == 'xmlns') {
							childNs.push({ prefix: '', namespace: attr.value });
						}
					}

					for (var i = 0; i < len; i++) {
						var attr = attrs.item(i);
						if (needNamespaceDefine(attr, html, childNs)) {
							var attrPrefix = attr.prefix || '';
							var uri = attr.namespaceURI;
							addSerializedAttribute(buf, attrPrefix ? 'xmlns:' + attrPrefix : 'xmlns', uri);
							childNs.push({ prefix: attrPrefix, namespace: uri });
						}
						// Apply nodeFilter and serialize the attribute.
						var filteredAttr = nodeFilter ? nodeFilter(attr) : attr;
						if (filteredAttr) {
							if (typeof filteredAttr === 'string') {
								buf.push(filteredAttr);
							} else {
								addSerializedAttribute(buf, filteredAttr.name, filteredAttr.value);
							}
						}
					}

					// add namespace for current node
					if (nodeName === prefixedNodeName && needNamespaceDefine(n, html, childNs)) {
						var nodePrefix = n.prefix || '';
						var uri = n.namespaceURI;
						addSerializedAttribute(buf, nodePrefix ? 'xmlns:' + nodePrefix : 'xmlns', uri);
						childNs.push({ prefix: nodePrefix, namespace: uri });
					}

					var child = n.firstChild;
					if (child || html && !/^(?:meta|link|img|br|hr|input)$/i.test(nodeName)) {
						buf.push('>');
						if (html && /^script$/i.test(nodeName)) {
							// Inline serialization for <script> children; return null to skip walkDOM descent.
							while (child) {
								if (child.data) {
									buf.push(child.data);
								} else {
									serializeToString(child, buf, html, nodeFilter, childNs.slice(), requireWellFormed);
								}
								child = child.nextSibling;
							}
							buf.push('</', nodeName, '>');
							return null;
						}
						// Return child context; walkDOM descends and exit emits the closing tag.
						return { ns: childNs, isHTML: html, tag: prefixedNodeName };
					} else {
						buf.push('/>');
						return null;
					}

				case DOCUMENT_NODE:
				case DOCUMENT_FRAGMENT_NODE:
					// Descend into children; exit is a no-op (tag is null).
					return { ns: ns.slice(), isHTML: html, tag: null };

				case ATTRIBUTE_NODE:
					addSerializedAttribute(buf, n.name, n.value);
					return null;

				case TEXT_NODE:
					/**
					 * The ampersand character (&) and the left angle bracket (<) must not appear in their literal form,
					 * except when used as markup delimiters, or within a comment, a processing instruction, or a CDATA section.
					 * If they are needed elsewhere, they must be escaped using either numeric character references or the strings
					 * `&amp;` and `&lt;` respectively.
					 * The right angle bracket (>) may be represented using the string " &gt; ", and must, for compatibility,
					 * be escaped using either `&gt;` or a character reference when it appears in the string `]]>` in content,
					 * when that string is not marking the end of a CDATA section.
					 *
					 * In the content of elements, character data is any string of characters
					 * which does not contain the start-delimiter of any markup
					 * and does not include the CDATA-section-close delimiter, `]]>`.
					 *
					 * @see https://www.w3.org/TR/xml/#NT-CharData
					 * @see https://w3c.github.io/DOM-Parsing/#xml-serializing-a-text-node
					 */
					buf.push(n.data.replace(/[<&>]/g, _xmlEncoder));
					return null;

				case CDATA_SECTION_NODE:
					if (requireWellFormed && n.data.indexOf(']]>') !== -1) {
						throw new DOMException(INVALID_STATE_ERR, 'The CDATASection data contains "]]>"');
					}
					buf.push('<![CDATA[', n.data.replace(/]]>/g, ']]]]><![CDATA[>'), ']]>');
					return null;

				case COMMENT_NODE:
					if (requireWellFormed && n.data.indexOf('-->') !== -1) {
						throw new DOMException(INVALID_STATE_ERR, 'The comment node data contains "-->"');
					}
					buf.push('<!--', n.data, '-->');
					return null;

				case DOCUMENT_TYPE_NODE:
					if (requireWellFormed) {
						if (n.publicId && !/^("[\x20\r\na-zA-Z0-9\-()+,.\/:=?;!*#@$_%']*"|'[\x20\r\na-zA-Z0-9\-()+,.\/:=?;!*#@$_%'"]*')$/.test(n.publicId)) {
							throw new DOMException(INVALID_STATE_ERR, 'DocumentType publicId is not a valid PubidLiteral');
						}
						if (n.systemId && !/^("[^"]*"|'[^']*')$/.test(n.systemId)) {
							throw new DOMException(INVALID_STATE_ERR, 'DocumentType systemId is not a valid SystemLiteral');
						}
						if (n.internalSubset && n.internalSubset.indexOf(']>') !== -1) {
							throw new DOMException(INVALID_STATE_ERR, 'DocumentType internalSubset contains "]>"');
						}
					}
					var pubid = n.publicId;
					var sysid = n.systemId;
					buf.push('<!DOCTYPE ', n.name);
					if (pubid) {
						buf.push(' PUBLIC ', pubid);
						if (sysid && sysid != '.') {
							buf.push(' ', sysid);
						}
						buf.push('>');
					} else if (sysid && sysid != '.') {
						buf.push(' SYSTEM ', sysid, '>');
					} else {
						var sub = n.internalSubset;
						if (sub) {
							buf.push(' [', sub, ']');
						}
						buf.push('>');
					}
					return null;

				case PROCESSING_INSTRUCTION_NODE:
					if (requireWellFormed && n.data.indexOf('?>') !== -1) {
						throw new DOMException(INVALID_STATE_ERR, 'The ProcessingInstruction data contains "?>"');
					}
					buf.push('<?', n.target, ' ', n.data, '?>');
					return null;

				case ENTITY_REFERENCE_NODE:
					buf.push('&', n.nodeName, ';');
					return null;

				//case ENTITY_NODE:
				//case NOTATION_NODE:
				default:
					buf.push('??', n.nodeName);
					return null;
			}
		},
		exit: function (n, childCtx) {
			if (childCtx && childCtx.tag) {
				buf.push('</', childCtx.tag, '>');
			}
		},
	});
}
/**
 * Imports a node from a different document into `doc`, creating a new copy.
 * Delegates to {@link walkDOM} for traversal. Each node in the subtree is shallow-cloned,
 * stamped with `doc` as its `ownerDocument`, and detached (`parentNode` set to `null`).
 * Children are imported recursively when `deep` is `true`; for {@link Attr} nodes `deep` is
 * always forced to `true`
 * because an attribute's value lives in a child text node.
 *
 * @param {Document} doc
 * The document that will own the imported node.
 * @param {Node} node
 * The node to import.
 * @param {boolean} deep
 * If `true`, descendants are imported recursively.
 * @returns {Node}
 * The newly imported node, now owned by `doc`.
 */
function importNode(doc, node, deep) {
	var destRoot;
	walkDOM(node, null, {
		enter: function (srcNode, destParent) {
			// Shallow-clone the node and stamp it into the target document.
			var destNode = srcNode.cloneNode(false);
			destNode.ownerDocument = doc;
			destNode.parentNode = null;
			// capture as the root of the imported subtree or attach to parent.
			if (destParent === null) {
				destRoot = destNode;
			} else {
				destParent.appendChild(destNode);
			}
			// ATTRIBUTE_NODE must always be imported deeply: its value lives in a child text node.
			var shouldDeep = srcNode.nodeType === ATTRIBUTE_NODE || deep;
			return shouldDeep ? destNode : null;
		},
	});
	return destRoot;
}
//
//var _relationMap = {firstChild:1,lastChild:1,previousSibling:1,nextSibling:1,
//					attributes:1,childNodes:1,parentNode:1,documentElement:1,doctype,};
function cloneNode(doc, node, deep) {
	var destRoot;
	walkDOM(node, null, {
		enter: function (srcNode, destParent) {
			// 1. Create a blank node of the same type and copy all scalar own properties.
			var destNode = new srcNode.constructor();
			for (var n in srcNode) {
				if (Object.prototype.hasOwnProperty.call(srcNode, n)) {
					var v = srcNode[n];
					if (typeof v != 'object') {
						if (v != destNode[n]) {
							destNode[n] = v;
						}
					}
				}
			}
			if (srcNode.childNodes) {
				destNode.childNodes = new NodeList();
			}
			destNode.ownerDocument = doc;
			// 2. Handle node-type-specific setup.
			//    Attributes are not DOM children, so they are cloned inline here
			//    rather than by walkDOM descent.
			//    ATTRIBUTE_NODE forces deep=true so its own children are walked.
			var shouldDeep = deep;
			switch (destNode.nodeType) {
				case ELEMENT_NODE:
					var attrs = srcNode.attributes;
					var attrs2 = (destNode.attributes = new NamedNodeMap());
					var len = attrs.length;
					attrs2._ownerElement = destNode;
					for (var i = 0; i < len; i++) {
						destNode.setAttributeNode(cloneNode(doc, attrs.item(i), true));
					}
					break;
				case ATTRIBUTE_NODE:
					shouldDeep = true;
			}
			// 3. Attach to parent, or capture as the root of the cloned subtree.
			if (destParent !== null) {
				destParent.appendChild(destNode);
			} else {
				destRoot = destNode;
			}
			// 4. Return destNode as the context for children (causes walkDOM to descend),
			//    or null to skip children (shallow clone).
			return shouldDeep ? destNode : null;
		},
	});
	return destRoot;
}

function __set__(object,key,value){
	object[key] = value
}
//do dynamic
try{
	if(Object.defineProperty){
		Object.defineProperty(LiveNodeList.prototype,'length',{
			get:function(){
				_updateLiveList(this);
				return this.$$length;
			}
		});

		/**
		 * The text content of this node and its descendants.
		 *
		 * Setting `textContent` on an element or document fragment replaces all child nodes with a
		 * single text node; on other nodes it sets `data`, `value`, and `nodeValue` directly.
		 *
		 * @type {string | null}
		 * @see {@link https://dom.spec.whatwg.org/#dom-node-textcontent}
		 */
		Object.defineProperty(Node.prototype, 'textContent', {
			get: function () {
				if (this.nodeType === ELEMENT_NODE || this.nodeType === DOCUMENT_FRAGMENT_NODE) {
					var buf = [];
					walkDOM(this, null, {
						enter: function (n) {
							if (n.nodeType === ELEMENT_NODE || n.nodeType === DOCUMENT_FRAGMENT_NODE) {
								return true; // enter children
							}
							if (n.nodeType === PROCESSING_INSTRUCTION_NODE || n.nodeType === COMMENT_NODE) {
								return null; // excluded from text content
							}
							buf.push(n.nodeValue);
						},
					});
					return buf.join('');
				}
				return this.nodeValue;
			},

			set: function (data) {
				switch (this.nodeType) {
					case ELEMENT_NODE:
					case DOCUMENT_FRAGMENT_NODE:
						while (this.firstChild) {
							this.removeChild(this.firstChild);
						}
						if (data || String(data)) {
							this.appendChild(this.ownerDocument.createTextNode(data));
						}
						break;

					default:
						this.data = data;
						this.value = data;
						this.nodeValue = data;
				}
			},
		})

		__set__ = function(object,key,value){
			//console.log(value)
			object['$$'+key] = value
		}
	}
}catch(e){//ie8
}

//if(typeof require == 'function'){
	exports.DocumentType = DocumentType;
	exports.DOMException = DOMException;
	exports.DOMImplementation = DOMImplementation;
	exports.Element = Element;
	exports.Node = Node;
	exports.NodeList = NodeList;
	exports.walkDOM = walkDOM;
	exports.XMLSerializer = XMLSerializer;
//}


/***/ }),

/***/ 56559:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";


var freeze = (__webpack_require__(44582).freeze);

/**
 * The entities that are predefined in every XML document.
 *
 * @see https://www.w3.org/TR/2006/REC-xml11-20060816/#sec-predefined-ent W3C XML 1.1
 * @see https://www.w3.org/TR/2008/REC-xml-20081126/#sec-predefined-ent W3C XML 1.0
 * @see https://en.wikipedia.org/wiki/List_of_XML_and_HTML_character_entity_references#Predefined_entities_in_XML Wikipedia
 */
exports.XML_ENTITIES = freeze({
	amp: '&',
	apos: "'",
	gt: '>',
	lt: '<',
	quot: '"',
});

/**
 * A map of all entities that are detected in an HTML document.
 * They contain all entries from `XML_ENTITIES`.
 *
 * @see XML_ENTITIES
 * @see DOMParser.parseFromString
 * @see DOMImplementation.prototype.createHTMLDocument
 * @see https://html.spec.whatwg.org/#named-character-references WHATWG HTML(5) Spec
 * @see https://html.spec.whatwg.org/entities.json JSON
 * @see https://www.w3.org/TR/xml-entity-names/ W3C XML Entity Names
 * @see https://www.w3.org/TR/html4/sgml/entities.html W3C HTML4/SGML
 * @see https://en.wikipedia.org/wiki/List_of_XML_and_HTML_character_entity_references#Character_entity_references_in_HTML Wikipedia (HTML)
 * @see https://en.wikipedia.org/wiki/List_of_XML_and_HTML_character_entity_references#Entities_representing_special_characters_in_XHTML Wikpedia (XHTML)
 */
exports.HTML_ENTITIES = freeze({
	Aacute: '\u00C1',
	aacute: '\u00E1',
	Abreve: '\u0102',
	abreve: '\u0103',
	ac: '\u223E',
	acd: '\u223F',
	acE: '\u223E\u0333',
	Acirc: '\u00C2',
	acirc: '\u00E2',
	acute: '\u00B4',
	Acy: '\u0410',
	acy: '\u0430',
	AElig: '\u00C6',
	aelig: '\u00E6',
	af: '\u2061',
	Afr: '\uD835\uDD04',
	afr: '\uD835\uDD1E',
	Agrave: '\u00C0',
	agrave: '\u00E0',
	alefsym: '\u2135',
	aleph: '\u2135',
	Alpha: '\u0391',
	alpha: '\u03B1',
	Amacr: '\u0100',
	amacr: '\u0101',
	amalg: '\u2A3F',
	AMP: '\u0026',
	amp: '\u0026',
	And: '\u2A53',
	and: '\u2227',
	andand: '\u2A55',
	andd: '\u2A5C',
	andslope: '\u2A58',
	andv: '\u2A5A',
	ang: '\u2220',
	ange: '\u29A4',
	angle: '\u2220',
	angmsd: '\u2221',
	angmsdaa: '\u29A8',
	angmsdab: '\u29A9',
	angmsdac: '\u29AA',
	angmsdad: '\u29AB',
	angmsdae: '\u29AC',
	angmsdaf: '\u29AD',
	angmsdag: '\u29AE',
	angmsdah: '\u29AF',
	angrt: '\u221F',
	angrtvb: '\u22BE',
	angrtvbd: '\u299D',
	angsph: '\u2222',
	angst: '\u00C5',
	angzarr: '\u237C',
	Aogon: '\u0104',
	aogon: '\u0105',
	Aopf: '\uD835\uDD38',
	aopf: '\uD835\uDD52',
	ap: '\u2248',
	apacir: '\u2A6F',
	apE: '\u2A70',
	ape: '\u224A',
	apid: '\u224B',
	apos: '\u0027',
	ApplyFunction: '\u2061',
	approx: '\u2248',
	approxeq: '\u224A',
	Aring: '\u00C5',
	aring: '\u00E5',
	Ascr: '\uD835\uDC9C',
	ascr: '\uD835\uDCB6',
	Assign: '\u2254',
	ast: '\u002A',
	asymp: '\u2248',
	asympeq: '\u224D',
	Atilde: '\u00C3',
	atilde: '\u00E3',
	Auml: '\u00C4',
	auml: '\u00E4',
	awconint: '\u2233',
	awint: '\u2A11',
	backcong: '\u224C',
	backepsilon: '\u03F6',
	backprime: '\u2035',
	backsim: '\u223D',
	backsimeq: '\u22CD',
	Backslash: '\u2216',
	Barv: '\u2AE7',
	barvee: '\u22BD',
	Barwed: '\u2306',
	barwed: '\u2305',
	barwedge: '\u2305',
	bbrk: '\u23B5',
	bbrktbrk: '\u23B6',
	bcong: '\u224C',
	Bcy: '\u0411',
	bcy: '\u0431',
	bdquo: '\u201E',
	becaus: '\u2235',
	Because: '\u2235',
	because: '\u2235',
	bemptyv: '\u29B0',
	bepsi: '\u03F6',
	bernou: '\u212C',
	Bernoullis: '\u212C',
	Beta: '\u0392',
	beta: '\u03B2',
	beth: '\u2136',
	between: '\u226C',
	Bfr: '\uD835\uDD05',
	bfr: '\uD835\uDD1F',
	bigcap: '\u22C2',
	bigcirc: '\u25EF',
	bigcup: '\u22C3',
	bigodot: '\u2A00',
	bigoplus: '\u2A01',
	bigotimes: '\u2A02',
	bigsqcup: '\u2A06',
	bigstar: '\u2605',
	bigtriangledown: '\u25BD',
	bigtriangleup: '\u25B3',
	biguplus: '\u2A04',
	bigvee: '\u22C1',
	bigwedge: '\u22C0',
	bkarow: '\u290D',
	blacklozenge: '\u29EB',
	blacksquare: '\u25AA',
	blacktriangle: '\u25B4',
	blacktriangledown: '\u25BE',
	blacktriangleleft: '\u25C2',
	blacktriangleright: '\u25B8',
	blank: '\u2423',
	blk12: '\u2592',
	blk14: '\u2591',
	blk34: '\u2593',
	block: '\u2588',
	bne: '\u003D\u20E5',
	bnequiv: '\u2261\u20E5',
	bNot: '\u2AED',
	bnot: '\u2310',
	Bopf: '\uD835\uDD39',
	bopf: '\uD835\uDD53',
	bot: '\u22A5',
	bottom: '\u22A5',
	bowtie: '\u22C8',
	boxbox: '\u29C9',
	boxDL: '\u2557',
	boxDl: '\u2556',
	boxdL: '\u2555',
	boxdl: '\u2510',
	boxDR: '\u2554',
	boxDr: '\u2553',
	boxdR: '\u2552',
	boxdr: '\u250C',
	boxH: '\u2550',
	boxh: '\u2500',
	boxHD: '\u2566',
	boxHd: '\u2564',
	boxhD: '\u2565',
	boxhd: '\u252C',
	boxHU: '\u2569',
	boxHu: '\u2567',
	boxhU: '\u2568',
	boxhu: '\u2534',
	boxminus: '\u229F',
	boxplus: '\u229E',
	boxtimes: '\u22A0',
	boxUL: '\u255D',
	boxUl: '\u255C',
	boxuL: '\u255B',
	boxul: '\u2518',
	boxUR: '\u255A',
	boxUr: '\u2559',
	boxuR: '\u2558',
	boxur: '\u2514',
	boxV: '\u2551',
	boxv: '\u2502',
	boxVH: '\u256C',
	boxVh: '\u256B',
	boxvH: '\u256A',
	boxvh: '\u253C',
	boxVL: '\u2563',
	boxVl: '\u2562',
	boxvL: '\u2561',
	boxvl: '\u2524',
	boxVR: '\u2560',
	boxVr: '\u255F',
	boxvR: '\u255E',
	boxvr: '\u251C',
	bprime: '\u2035',
	Breve: '\u02D8',
	breve: '\u02D8',
	brvbar: '\u00A6',
	Bscr: '\u212C',
	bscr: '\uD835\uDCB7',
	bsemi: '\u204F',
	bsim: '\u223D',
	bsime: '\u22CD',
	bsol: '\u005C',
	bsolb: '\u29C5',
	bsolhsub: '\u27C8',
	bull: '\u2022',
	bullet: '\u2022',
	bump: '\u224E',
	bumpE: '\u2AAE',
	bumpe: '\u224F',
	Bumpeq: '\u224E',
	bumpeq: '\u224F',
	Cacute: '\u0106',
	cacute: '\u0107',
	Cap: '\u22D2',
	cap: '\u2229',
	capand: '\u2A44',
	capbrcup: '\u2A49',
	capcap: '\u2A4B',
	capcup: '\u2A47',
	capdot: '\u2A40',
	CapitalDifferentialD: '\u2145',
	caps: '\u2229\uFE00',
	caret: '\u2041',
	caron: '\u02C7',
	Cayleys: '\u212D',
	ccaps: '\u2A4D',
	Ccaron: '\u010C',
	ccaron: '\u010D',
	Ccedil: '\u00C7',
	ccedil: '\u00E7',
	Ccirc: '\u0108',
	ccirc: '\u0109',
	Cconint: '\u2230',
	ccups: '\u2A4C',
	ccupssm: '\u2A50',
	Cdot: '\u010A',
	cdot: '\u010B',
	cedil: '\u00B8',
	Cedilla: '\u00B8',
	cemptyv: '\u29B2',
	cent: '\u00A2',
	CenterDot: '\u00B7',
	centerdot: '\u00B7',
	Cfr: '\u212D',
	cfr: '\uD835\uDD20',
	CHcy: '\u0427',
	chcy: '\u0447',
	check: '\u2713',
	checkmark: '\u2713',
	Chi: '\u03A7',
	chi: '\u03C7',
	cir: '\u25CB',
	circ: '\u02C6',
	circeq: '\u2257',
	circlearrowleft: '\u21BA',
	circlearrowright: '\u21BB',
	circledast: '\u229B',
	circledcirc: '\u229A',
	circleddash: '\u229D',
	CircleDot: '\u2299',
	circledR: '\u00AE',
	circledS: '\u24C8',
	CircleMinus: '\u2296',
	CirclePlus: '\u2295',
	CircleTimes: '\u2297',
	cirE: '\u29C3',
	cire: '\u2257',
	cirfnint: '\u2A10',
	cirmid: '\u2AEF',
	cirscir: '\u29C2',
	ClockwiseContourIntegral: '\u2232',
	CloseCurlyDoubleQuote: '\u201D',
	CloseCurlyQuote: '\u2019',
	clubs: '\u2663',
	clubsuit: '\u2663',
	Colon: '\u2237',
	colon: '\u003A',
	Colone: '\u2A74',
	colone: '\u2254',
	coloneq: '\u2254',
	comma: '\u002C',
	commat: '\u0040',
	comp: '\u2201',
	compfn: '\u2218',
	complement: '\u2201',
	complexes: '\u2102',
	cong: '\u2245',
	congdot: '\u2A6D',
	Congruent: '\u2261',
	Conint: '\u222F',
	conint: '\u222E',
	ContourIntegral: '\u222E',
	Copf: '\u2102',
	copf: '\uD835\uDD54',
	coprod: '\u2210',
	Coproduct: '\u2210',
	COPY: '\u00A9',
	copy: '\u00A9',
	copysr: '\u2117',
	CounterClockwiseContourIntegral: '\u2233',
	crarr: '\u21B5',
	Cross: '\u2A2F',
	cross: '\u2717',
	Cscr: '\uD835\uDC9E',
	cscr: '\uD835\uDCB8',
	csub: '\u2ACF',
	csube: '\u2AD1',
	csup: '\u2AD0',
	csupe: '\u2AD2',
	ctdot: '\u22EF',
	cudarrl: '\u2938',
	cudarrr: '\u2935',
	cuepr: '\u22DE',
	cuesc: '\u22DF',
	cularr: '\u21B6',
	cularrp: '\u293D',
	Cup: '\u22D3',
	cup: '\u222A',
	cupbrcap: '\u2A48',
	CupCap: '\u224D',
	cupcap: '\u2A46',
	cupcup: '\u2A4A',
	cupdot: '\u228D',
	cupor: '\u2A45',
	cups: '\u222A\uFE00',
	curarr: '\u21B7',
	curarrm: '\u293C',
	curlyeqprec: '\u22DE',
	curlyeqsucc: '\u22DF',
	curlyvee: '\u22CE',
	curlywedge: '\u22CF',
	curren: '\u00A4',
	curvearrowleft: '\u21B6',
	curvearrowright: '\u21B7',
	cuvee: '\u22CE',
	cuwed: '\u22CF',
	cwconint: '\u2232',
	cwint: '\u2231',
	cylcty: '\u232D',
	Dagger: '\u2021',
	dagger: '\u2020',
	daleth: '\u2138',
	Darr: '\u21A1',
	dArr: '\u21D3',
	darr: '\u2193',
	dash: '\u2010',
	Dashv: '\u2AE4',
	dashv: '\u22A3',
	dbkarow: '\u290F',
	dblac: '\u02DD',
	Dcaron: '\u010E',
	dcaron: '\u010F',
	Dcy: '\u0414',
	dcy: '\u0434',
	DD: '\u2145',
	dd: '\u2146',
	ddagger: '\u2021',
	ddarr: '\u21CA',
	DDotrahd: '\u2911',
	ddotseq: '\u2A77',
	deg: '\u00B0',
	Del: '\u2207',
	Delta: '\u0394',
	delta: '\u03B4',
	demptyv: '\u29B1',
	dfisht: '\u297F',
	Dfr: '\uD835\uDD07',
	dfr: '\uD835\uDD21',
	dHar: '\u2965',
	dharl: '\u21C3',
	dharr: '\u21C2',
	DiacriticalAcute: '\u00B4',
	DiacriticalDot: '\u02D9',
	DiacriticalDoubleAcute: '\u02DD',
	DiacriticalGrave: '\u0060',
	DiacriticalTilde: '\u02DC',
	diam: '\u22C4',
	Diamond: '\u22C4',
	diamond: '\u22C4',
	diamondsuit: '\u2666',
	diams: '\u2666',
	die: '\u00A8',
	DifferentialD: '\u2146',
	digamma: '\u03DD',
	disin: '\u22F2',
	div: '\u00F7',
	divide: '\u00F7',
	divideontimes: '\u22C7',
	divonx: '\u22C7',
	DJcy: '\u0402',
	djcy: '\u0452',
	dlcorn: '\u231E',
	dlcrop: '\u230D',
	dollar: '\u0024',
	Dopf: '\uD835\uDD3B',
	dopf: '\uD835\uDD55',
	Dot: '\u00A8',
	dot: '\u02D9',
	DotDot: '\u20DC',
	doteq: '\u2250',
	doteqdot: '\u2251',
	DotEqual: '\u2250',
	dotminus: '\u2238',
	dotplus: '\u2214',
	dotsquare: '\u22A1',
	doublebarwedge: '\u2306',
	DoubleContourIntegral: '\u222F',
	DoubleDot: '\u00A8',
	DoubleDownArrow: '\u21D3',
	DoubleLeftArrow: '\u21D0',
	DoubleLeftRightArrow: '\u21D4',
	DoubleLeftTee: '\u2AE4',
	DoubleLongLeftArrow: '\u27F8',
	DoubleLongLeftRightArrow: '\u27FA',
	DoubleLongRightArrow: '\u27F9',
	DoubleRightArrow: '\u21D2',
	DoubleRightTee: '\u22A8',
	DoubleUpArrow: '\u21D1',
	DoubleUpDownArrow: '\u21D5',
	DoubleVerticalBar: '\u2225',
	DownArrow: '\u2193',
	Downarrow: '\u21D3',
	downarrow: '\u2193',
	DownArrowBar: '\u2913',
	DownArrowUpArrow: '\u21F5',
	DownBreve: '\u0311',
	downdownarrows: '\u21CA',
	downharpoonleft: '\u21C3',
	downharpoonright: '\u21C2',
	DownLeftRightVector: '\u2950',
	DownLeftTeeVector: '\u295E',
	DownLeftVector: '\u21BD',
	DownLeftVectorBar: '\u2956',
	DownRightTeeVector: '\u295F',
	DownRightVector: '\u21C1',
	DownRightVectorBar: '\u2957',
	DownTee: '\u22A4',
	DownTeeArrow: '\u21A7',
	drbkarow: '\u2910',
	drcorn: '\u231F',
	drcrop: '\u230C',
	Dscr: '\uD835\uDC9F',
	dscr: '\uD835\uDCB9',
	DScy: '\u0405',
	dscy: '\u0455',
	dsol: '\u29F6',
	Dstrok: '\u0110',
	dstrok: '\u0111',
	dtdot: '\u22F1',
	dtri: '\u25BF',
	dtrif: '\u25BE',
	duarr: '\u21F5',
	duhar: '\u296F',
	dwangle: '\u29A6',
	DZcy: '\u040F',
	dzcy: '\u045F',
	dzigrarr: '\u27FF',
	Eacute: '\u00C9',
	eacute: '\u00E9',
	easter: '\u2A6E',
	Ecaron: '\u011A',
	ecaron: '\u011B',
	ecir: '\u2256',
	Ecirc: '\u00CA',
	ecirc: '\u00EA',
	ecolon: '\u2255',
	Ecy: '\u042D',
	ecy: '\u044D',
	eDDot: '\u2A77',
	Edot: '\u0116',
	eDot: '\u2251',
	edot: '\u0117',
	ee: '\u2147',
	efDot: '\u2252',
	Efr: '\uD835\uDD08',
	efr: '\uD835\uDD22',
	eg: '\u2A9A',
	Egrave: '\u00C8',
	egrave: '\u00E8',
	egs: '\u2A96',
	egsdot: '\u2A98',
	el: '\u2A99',
	Element: '\u2208',
	elinters: '\u23E7',
	ell: '\u2113',
	els: '\u2A95',
	elsdot: '\u2A97',
	Emacr: '\u0112',
	emacr: '\u0113',
	empty: '\u2205',
	emptyset: '\u2205',
	EmptySmallSquare: '\u25FB',
	emptyv: '\u2205',
	EmptyVerySmallSquare: '\u25AB',
	emsp: '\u2003',
	emsp13: '\u2004',
	emsp14: '\u2005',
	ENG: '\u014A',
	eng: '\u014B',
	ensp: '\u2002',
	Eogon: '\u0118',
	eogon: '\u0119',
	Eopf: '\uD835\uDD3C',
	eopf: '\uD835\uDD56',
	epar: '\u22D5',
	eparsl: '\u29E3',
	eplus: '\u2A71',
	epsi: '\u03B5',
	Epsilon: '\u0395',
	epsilon: '\u03B5',
	epsiv: '\u03F5',
	eqcirc: '\u2256',
	eqcolon: '\u2255',
	eqsim: '\u2242',
	eqslantgtr: '\u2A96',
	eqslantless: '\u2A95',
	Equal: '\u2A75',
	equals: '\u003D',
	EqualTilde: '\u2242',
	equest: '\u225F',
	Equilibrium: '\u21CC',
	equiv: '\u2261',
	equivDD: '\u2A78',
	eqvparsl: '\u29E5',
	erarr: '\u2971',
	erDot: '\u2253',
	Escr: '\u2130',
	escr: '\u212F',
	esdot: '\u2250',
	Esim: '\u2A73',
	esim: '\u2242',
	Eta: '\u0397',
	eta: '\u03B7',
	ETH: '\u00D0',
	eth: '\u00F0',
	Euml: '\u00CB',
	euml: '\u00EB',
	euro: '\u20AC',
	excl: '\u0021',
	exist: '\u2203',
	Exists: '\u2203',
	expectation: '\u2130',
	ExponentialE: '\u2147',
	exponentiale: '\u2147',
	fallingdotseq: '\u2252',
	Fcy: '\u0424',
	fcy: '\u0444',
	female: '\u2640',
	ffilig: '\uFB03',
	fflig: '\uFB00',
	ffllig: '\uFB04',
	Ffr: '\uD835\uDD09',
	ffr: '\uD835\uDD23',
	filig: '\uFB01',
	FilledSmallSquare: '\u25FC',
	FilledVerySmallSquare: '\u25AA',
	fjlig: '\u0066\u006A',
	flat: '\u266D',
	fllig: '\uFB02',
	fltns: '\u25B1',
	fnof: '\u0192',
	Fopf: '\uD835\uDD3D',
	fopf: '\uD835\uDD57',
	ForAll: '\u2200',
	forall: '\u2200',
	fork: '\u22D4',
	forkv: '\u2AD9',
	Fouriertrf: '\u2131',
	fpartint: '\u2A0D',
	frac12: '\u00BD',
	frac13: '\u2153',
	frac14: '\u00BC',
	frac15: '\u2155',
	frac16: '\u2159',
	frac18: '\u215B',
	frac23: '\u2154',
	frac25: '\u2156',
	frac34: '\u00BE',
	frac35: '\u2157',
	frac38: '\u215C',
	frac45: '\u2158',
	frac56: '\u215A',
	frac58: '\u215D',
	frac78: '\u215E',
	frasl: '\u2044',
	frown: '\u2322',
	Fscr: '\u2131',
	fscr: '\uD835\uDCBB',
	gacute: '\u01F5',
	Gamma: '\u0393',
	gamma: '\u03B3',
	Gammad: '\u03DC',
	gammad: '\u03DD',
	gap: '\u2A86',
	Gbreve: '\u011E',
	gbreve: '\u011F',
	Gcedil: '\u0122',
	Gcirc: '\u011C',
	gcirc: '\u011D',
	Gcy: '\u0413',
	gcy: '\u0433',
	Gdot: '\u0120',
	gdot: '\u0121',
	gE: '\u2267',
	ge: '\u2265',
	gEl: '\u2A8C',
	gel: '\u22DB',
	geq: '\u2265',
	geqq: '\u2267',
	geqslant: '\u2A7E',
	ges: '\u2A7E',
	gescc: '\u2AA9',
	gesdot: '\u2A80',
	gesdoto: '\u2A82',
	gesdotol: '\u2A84',
	gesl: '\u22DB\uFE00',
	gesles: '\u2A94',
	Gfr: '\uD835\uDD0A',
	gfr: '\uD835\uDD24',
	Gg: '\u22D9',
	gg: '\u226B',
	ggg: '\u22D9',
	gimel: '\u2137',
	GJcy: '\u0403',
	gjcy: '\u0453',
	gl: '\u2277',
	gla: '\u2AA5',
	glE: '\u2A92',
	glj: '\u2AA4',
	gnap: '\u2A8A',
	gnapprox: '\u2A8A',
	gnE: '\u2269',
	gne: '\u2A88',
	gneq: '\u2A88',
	gneqq: '\u2269',
	gnsim: '\u22E7',
	Gopf: '\uD835\uDD3E',
	gopf: '\uD835\uDD58',
	grave: '\u0060',
	GreaterEqual: '\u2265',
	GreaterEqualLess: '\u22DB',
	GreaterFullEqual: '\u2267',
	GreaterGreater: '\u2AA2',
	GreaterLess: '\u2277',
	GreaterSlantEqual: '\u2A7E',
	GreaterTilde: '\u2273',
	Gscr: '\uD835\uDCA2',
	gscr: '\u210A',
	gsim: '\u2273',
	gsime: '\u2A8E',
	gsiml: '\u2A90',
	Gt: '\u226B',
	GT: '\u003E',
	gt: '\u003E',
	gtcc: '\u2AA7',
	gtcir: '\u2A7A',
	gtdot: '\u22D7',
	gtlPar: '\u2995',
	gtquest: '\u2A7C',
	gtrapprox: '\u2A86',
	gtrarr: '\u2978',
	gtrdot: '\u22D7',
	gtreqless: '\u22DB',
	gtreqqless: '\u2A8C',
	gtrless: '\u2277',
	gtrsim: '\u2273',
	gvertneqq: '\u2269\uFE00',
	gvnE: '\u2269\uFE00',
	Hacek: '\u02C7',
	hairsp: '\u200A',
	half: '\u00BD',
	hamilt: '\u210B',
	HARDcy: '\u042A',
	hardcy: '\u044A',
	hArr: '\u21D4',
	harr: '\u2194',
	harrcir: '\u2948',
	harrw: '\u21AD',
	Hat: '\u005E',
	hbar: '\u210F',
	Hcirc: '\u0124',
	hcirc: '\u0125',
	hearts: '\u2665',
	heartsuit: '\u2665',
	hellip: '\u2026',
	hercon: '\u22B9',
	Hfr: '\u210C',
	hfr: '\uD835\uDD25',
	HilbertSpace: '\u210B',
	hksearow: '\u2925',
	hkswarow: '\u2926',
	hoarr: '\u21FF',
	homtht: '\u223B',
	hookleftarrow: '\u21A9',
	hookrightarrow: '\u21AA',
	Hopf: '\u210D',
	hopf: '\uD835\uDD59',
	horbar: '\u2015',
	HorizontalLine: '\u2500',
	Hscr: '\u210B',
	hscr: '\uD835\uDCBD',
	hslash: '\u210F',
	Hstrok: '\u0126',
	hstrok: '\u0127',
	HumpDownHump: '\u224E',
	HumpEqual: '\u224F',
	hybull: '\u2043',
	hyphen: '\u2010',
	Iacute: '\u00CD',
	iacute: '\u00ED',
	ic: '\u2063',
	Icirc: '\u00CE',
	icirc: '\u00EE',
	Icy: '\u0418',
	icy: '\u0438',
	Idot: '\u0130',
	IEcy: '\u0415',
	iecy: '\u0435',
	iexcl: '\u00A1',
	iff: '\u21D4',
	Ifr: '\u2111',
	ifr: '\uD835\uDD26',
	Igrave: '\u00CC',
	igrave: '\u00EC',
	ii: '\u2148',
	iiiint: '\u2A0C',
	iiint: '\u222D',
	iinfin: '\u29DC',
	iiota: '\u2129',
	IJlig: '\u0132',
	ijlig: '\u0133',
	Im: '\u2111',
	Imacr: '\u012A',
	imacr: '\u012B',
	image: '\u2111',
	ImaginaryI: '\u2148',
	imagline: '\u2110',
	imagpart: '\u2111',
	imath: '\u0131',
	imof: '\u22B7',
	imped: '\u01B5',
	Implies: '\u21D2',
	in: '\u2208',
	incare: '\u2105',
	infin: '\u221E',
	infintie: '\u29DD',
	inodot: '\u0131',
	Int: '\u222C',
	int: '\u222B',
	intcal: '\u22BA',
	integers: '\u2124',
	Integral: '\u222B',
	intercal: '\u22BA',
	Intersection: '\u22C2',
	intlarhk: '\u2A17',
	intprod: '\u2A3C',
	InvisibleComma: '\u2063',
	InvisibleTimes: '\u2062',
	IOcy: '\u0401',
	iocy: '\u0451',
	Iogon: '\u012E',
	iogon: '\u012F',
	Iopf: '\uD835\uDD40',
	iopf: '\uD835\uDD5A',
	Iota: '\u0399',
	iota: '\u03B9',
	iprod: '\u2A3C',
	iquest: '\u00BF',
	Iscr: '\u2110',
	iscr: '\uD835\uDCBE',
	isin: '\u2208',
	isindot: '\u22F5',
	isinE: '\u22F9',
	isins: '\u22F4',
	isinsv: '\u22F3',
	isinv: '\u2208',
	it: '\u2062',
	Itilde: '\u0128',
	itilde: '\u0129',
	Iukcy: '\u0406',
	iukcy: '\u0456',
	Iuml: '\u00CF',
	iuml: '\u00EF',
	Jcirc: '\u0134',
	jcirc: '\u0135',
	Jcy: '\u0419',
	jcy: '\u0439',
	Jfr: '\uD835\uDD0D',
	jfr: '\uD835\uDD27',
	jmath: '\u0237',
	Jopf: '\uD835\uDD41',
	jopf: '\uD835\uDD5B',
	Jscr: '\uD835\uDCA5',
	jscr: '\uD835\uDCBF',
	Jsercy: '\u0408',
	jsercy: '\u0458',
	Jukcy: '\u0404',
	jukcy: '\u0454',
	Kappa: '\u039A',
	kappa: '\u03BA',
	kappav: '\u03F0',
	Kcedil: '\u0136',
	kcedil: '\u0137',
	Kcy: '\u041A',
	kcy: '\u043A',
	Kfr: '\uD835\uDD0E',
	kfr: '\uD835\uDD28',
	kgreen: '\u0138',
	KHcy: '\u0425',
	khcy: '\u0445',
	KJcy: '\u040C',
	kjcy: '\u045C',
	Kopf: '\uD835\uDD42',
	kopf: '\uD835\uDD5C',
	Kscr: '\uD835\uDCA6',
	kscr: '\uD835\uDCC0',
	lAarr: '\u21DA',
	Lacute: '\u0139',
	lacute: '\u013A',
	laemptyv: '\u29B4',
	lagran: '\u2112',
	Lambda: '\u039B',
	lambda: '\u03BB',
	Lang: '\u27EA',
	lang: '\u27E8',
	langd: '\u2991',
	langle: '\u27E8',
	lap: '\u2A85',
	Laplacetrf: '\u2112',
	laquo: '\u00AB',
	Larr: '\u219E',
	lArr: '\u21D0',
	larr: '\u2190',
	larrb: '\u21E4',
	larrbfs: '\u291F',
	larrfs: '\u291D',
	larrhk: '\u21A9',
	larrlp: '\u21AB',
	larrpl: '\u2939',
	larrsim: '\u2973',
	larrtl: '\u21A2',
	lat: '\u2AAB',
	lAtail: '\u291B',
	latail: '\u2919',
	late: '\u2AAD',
	lates: '\u2AAD\uFE00',
	lBarr: '\u290E',
	lbarr: '\u290C',
	lbbrk: '\u2772',
	lbrace: '\u007B',
	lbrack: '\u005B',
	lbrke: '\u298B',
	lbrksld: '\u298F',
	lbrkslu: '\u298D',
	Lcaron: '\u013D',
	lcaron: '\u013E',
	Lcedil: '\u013B',
	lcedil: '\u013C',
	lceil: '\u2308',
	lcub: '\u007B',
	Lcy: '\u041B',
	lcy: '\u043B',
	ldca: '\u2936',
	ldquo: '\u201C',
	ldquor: '\u201E',
	ldrdhar: '\u2967',
	ldrushar: '\u294B',
	ldsh: '\u21B2',
	lE: '\u2266',
	le: '\u2264',
	LeftAngleBracket: '\u27E8',
	LeftArrow: '\u2190',
	Leftarrow: '\u21D0',
	leftarrow: '\u2190',
	LeftArrowBar: '\u21E4',
	LeftArrowRightArrow: '\u21C6',
	leftarrowtail: '\u21A2',
	LeftCeiling: '\u2308',
	LeftDoubleBracket: '\u27E6',
	LeftDownTeeVector: '\u2961',
	LeftDownVector: '\u21C3',
	LeftDownVectorBar: '\u2959',
	LeftFloor: '\u230A',
	leftharpoondown: '\u21BD',
	leftharpoonup: '\u21BC',
	leftleftarrows: '\u21C7',
	LeftRightArrow: '\u2194',
	Leftrightarrow: '\u21D4',
	leftrightarrow: '\u2194',
	leftrightarrows: '\u21C6',
	leftrightharpoons: '\u21CB',
	leftrightsquigarrow: '\u21AD',
	LeftRightVector: '\u294E',
	LeftTee: '\u22A3',
	LeftTeeArrow: '\u21A4',
	LeftTeeVector: '\u295A',
	leftthreetimes: '\u22CB',
	LeftTriangle: '\u22B2',
	LeftTriangleBar: '\u29CF',
	LeftTriangleEqual: '\u22B4',
	LeftUpDownVector: '\u2951',
	LeftUpTeeVector: '\u2960',
	LeftUpVector: '\u21BF',
	LeftUpVectorBar: '\u2958',
	LeftVector: '\u21BC',
	LeftVectorBar: '\u2952',
	lEg: '\u2A8B',
	leg: '\u22DA',
	leq: '\u2264',
	leqq: '\u2266',
	leqslant: '\u2A7D',
	les: '\u2A7D',
	lescc: '\u2AA8',
	lesdot: '\u2A7F',
	lesdoto: '\u2A81',
	lesdotor: '\u2A83',
	lesg: '\u22DA\uFE00',
	lesges: '\u2A93',
	lessapprox: '\u2A85',
	lessdot: '\u22D6',
	lesseqgtr: '\u22DA',
	lesseqqgtr: '\u2A8B',
	LessEqualGreater: '\u22DA',
	LessFullEqual: '\u2266',
	LessGreater: '\u2276',
	lessgtr: '\u2276',
	LessLess: '\u2AA1',
	lesssim: '\u2272',
	LessSlantEqual: '\u2A7D',
	LessTilde: '\u2272',
	lfisht: '\u297C',
	lfloor: '\u230A',
	Lfr: '\uD835\uDD0F',
	lfr: '\uD835\uDD29',
	lg: '\u2276',
	lgE: '\u2A91',
	lHar: '\u2962',
	lhard: '\u21BD',
	lharu: '\u21BC',
	lharul: '\u296A',
	lhblk: '\u2584',
	LJcy: '\u0409',
	ljcy: '\u0459',
	Ll: '\u22D8',
	ll: '\u226A',
	llarr: '\u21C7',
	llcorner: '\u231E',
	Lleftarrow: '\u21DA',
	llhard: '\u296B',
	lltri: '\u25FA',
	Lmidot: '\u013F',
	lmidot: '\u0140',
	lmoust: '\u23B0',
	lmoustache: '\u23B0',
	lnap: '\u2A89',
	lnapprox: '\u2A89',
	lnE: '\u2268',
	lne: '\u2A87',
	lneq: '\u2A87',
	lneqq: '\u2268',
	lnsim: '\u22E6',
	loang: '\u27EC',
	loarr: '\u21FD',
	lobrk: '\u27E6',
	LongLeftArrow: '\u27F5',
	Longleftarrow: '\u27F8',
	longleftarrow: '\u27F5',
	LongLeftRightArrow: '\u27F7',
	Longleftrightarrow: '\u27FA',
	longleftrightarrow: '\u27F7',
	longmapsto: '\u27FC',
	LongRightArrow: '\u27F6',
	Longrightarrow: '\u27F9',
	longrightarrow: '\u27F6',
	looparrowleft: '\u21AB',
	looparrowright: '\u21AC',
	lopar: '\u2985',
	Lopf: '\uD835\uDD43',
	lopf: '\uD835\uDD5D',
	loplus: '\u2A2D',
	lotimes: '\u2A34',
	lowast: '\u2217',
	lowbar: '\u005F',
	LowerLeftArrow: '\u2199',
	LowerRightArrow: '\u2198',
	loz: '\u25CA',
	lozenge: '\u25CA',
	lozf: '\u29EB',
	lpar: '\u0028',
	lparlt: '\u2993',
	lrarr: '\u21C6',
	lrcorner: '\u231F',
	lrhar: '\u21CB',
	lrhard: '\u296D',
	lrm: '\u200E',
	lrtri: '\u22BF',
	lsaquo: '\u2039',
	Lscr: '\u2112',
	lscr: '\uD835\uDCC1',
	Lsh: '\u21B0',
	lsh: '\u21B0',
	lsim: '\u2272',
	lsime: '\u2A8D',
	lsimg: '\u2A8F',
	lsqb: '\u005B',
	lsquo: '\u2018',
	lsquor: '\u201A',
	Lstrok: '\u0141',
	lstrok: '\u0142',
	Lt: '\u226A',
	LT: '\u003C',
	lt: '\u003C',
	ltcc: '\u2AA6',
	ltcir: '\u2A79',
	ltdot: '\u22D6',
	lthree: '\u22CB',
	ltimes: '\u22C9',
	ltlarr: '\u2976',
	ltquest: '\u2A7B',
	ltri: '\u25C3',
	ltrie: '\u22B4',
	ltrif: '\u25C2',
	ltrPar: '\u2996',
	lurdshar: '\u294A',
	luruhar: '\u2966',
	lvertneqq: '\u2268\uFE00',
	lvnE: '\u2268\uFE00',
	macr: '\u00AF',
	male: '\u2642',
	malt: '\u2720',
	maltese: '\u2720',
	Map: '\u2905',
	map: '\u21A6',
	mapsto: '\u21A6',
	mapstodown: '\u21A7',
	mapstoleft: '\u21A4',
	mapstoup: '\u21A5',
	marker: '\u25AE',
	mcomma: '\u2A29',
	Mcy: '\u041C',
	mcy: '\u043C',
	mdash: '\u2014',
	mDDot: '\u223A',
	measuredangle: '\u2221',
	MediumSpace: '\u205F',
	Mellintrf: '\u2133',
	Mfr: '\uD835\uDD10',
	mfr: '\uD835\uDD2A',
	mho: '\u2127',
	micro: '\u00B5',
	mid: '\u2223',
	midast: '\u002A',
	midcir: '\u2AF0',
	middot: '\u00B7',
	minus: '\u2212',
	minusb: '\u229F',
	minusd: '\u2238',
	minusdu: '\u2A2A',
	MinusPlus: '\u2213',
	mlcp: '\u2ADB',
	mldr: '\u2026',
	mnplus: '\u2213',
	models: '\u22A7',
	Mopf: '\uD835\uDD44',
	mopf: '\uD835\uDD5E',
	mp: '\u2213',
	Mscr: '\u2133',
	mscr: '\uD835\uDCC2',
	mstpos: '\u223E',
	Mu: '\u039C',
	mu: '\u03BC',
	multimap: '\u22B8',
	mumap: '\u22B8',
	nabla: '\u2207',
	Nacute: '\u0143',
	nacute: '\u0144',
	nang: '\u2220\u20D2',
	nap: '\u2249',
	napE: '\u2A70\u0338',
	napid: '\u224B\u0338',
	napos: '\u0149',
	napprox: '\u2249',
	natur: '\u266E',
	natural: '\u266E',
	naturals: '\u2115',
	nbsp: '\u00A0',
	nbump: '\u224E\u0338',
	nbumpe: '\u224F\u0338',
	ncap: '\u2A43',
	Ncaron: '\u0147',
	ncaron: '\u0148',
	Ncedil: '\u0145',
	ncedil: '\u0146',
	ncong: '\u2247',
	ncongdot: '\u2A6D\u0338',
	ncup: '\u2A42',
	Ncy: '\u041D',
	ncy: '\u043D',
	ndash: '\u2013',
	ne: '\u2260',
	nearhk: '\u2924',
	neArr: '\u21D7',
	nearr: '\u2197',
	nearrow: '\u2197',
	nedot: '\u2250\u0338',
	NegativeMediumSpace: '\u200B',
	NegativeThickSpace: '\u200B',
	NegativeThinSpace: '\u200B',
	NegativeVeryThinSpace: '\u200B',
	nequiv: '\u2262',
	nesear: '\u2928',
	nesim: '\u2242\u0338',
	NestedGreaterGreater: '\u226B',
	NestedLessLess: '\u226A',
	NewLine: '\u000A',
	nexist: '\u2204',
	nexists: '\u2204',
	Nfr: '\uD835\uDD11',
	nfr: '\uD835\uDD2B',
	ngE: '\u2267\u0338',
	nge: '\u2271',
	ngeq: '\u2271',
	ngeqq: '\u2267\u0338',
	ngeqslant: '\u2A7E\u0338',
	nges: '\u2A7E\u0338',
	nGg: '\u22D9\u0338',
	ngsim: '\u2275',
	nGt: '\u226B\u20D2',
	ngt: '\u226F',
	ngtr: '\u226F',
	nGtv: '\u226B\u0338',
	nhArr: '\u21CE',
	nharr: '\u21AE',
	nhpar: '\u2AF2',
	ni: '\u220B',
	nis: '\u22FC',
	nisd: '\u22FA',
	niv: '\u220B',
	NJcy: '\u040A',
	njcy: '\u045A',
	nlArr: '\u21CD',
	nlarr: '\u219A',
	nldr: '\u2025',
	nlE: '\u2266\u0338',
	nle: '\u2270',
	nLeftarrow: '\u21CD',
	nleftarrow: '\u219A',
	nLeftrightarrow: '\u21CE',
	nleftrightarrow: '\u21AE',
	nleq: '\u2270',
	nleqq: '\u2266\u0338',
	nleqslant: '\u2A7D\u0338',
	nles: '\u2A7D\u0338',
	nless: '\u226E',
	nLl: '\u22D8\u0338',
	nlsim: '\u2274',
	nLt: '\u226A\u20D2',
	nlt: '\u226E',
	nltri: '\u22EA',
	nltrie: '\u22EC',
	nLtv: '\u226A\u0338',
	nmid: '\u2224',
	NoBreak: '\u2060',
	NonBreakingSpace: '\u00A0',
	Nopf: '\u2115',
	nopf: '\uD835\uDD5F',
	Not: '\u2AEC',
	not: '\u00AC',
	NotCongruent: '\u2262',
	NotCupCap: '\u226D',
	NotDoubleVerticalBar: '\u2226',
	NotElement: '\u2209',
	NotEqual: '\u2260',
	NotEqualTilde: '\u2242\u0338',
	NotExists: '\u2204',
	NotGreater: '\u226F',
	NotGreaterEqual: '\u2271',
	NotGreaterFullEqual: '\u2267\u0338',
	NotGreaterGreater: '\u226B\u0338',
	NotGreaterLess: '\u2279',
	NotGreaterSlantEqual: '\u2A7E\u0338',
	NotGreaterTilde: '\u2275',
	NotHumpDownHump: '\u224E\u0338',
	NotHumpEqual: '\u224F\u0338',
	notin: '\u2209',
	notindot: '\u22F5\u0338',
	notinE: '\u22F9\u0338',
	notinva: '\u2209',
	notinvb: '\u22F7',
	notinvc: '\u22F6',
	NotLeftTriangle: '\u22EA',
	NotLeftTriangleBar: '\u29CF\u0338',
	NotLeftTriangleEqual: '\u22EC',
	NotLess: '\u226E',
	NotLessEqual: '\u2270',
	NotLessGreater: '\u2278',
	NotLessLess: '\u226A\u0338',
	NotLessSlantEqual: '\u2A7D\u0338',
	NotLessTilde: '\u2274',
	NotNestedGreaterGreater: '\u2AA2\u0338',
	NotNestedLessLess: '\u2AA1\u0338',
	notni: '\u220C',
	notniva: '\u220C',
	notnivb: '\u22FE',
	notnivc: '\u22FD',
	NotPrecedes: '\u2280',
	NotPrecedesEqual: '\u2AAF\u0338',
	NotPrecedesSlantEqual: '\u22E0',
	NotReverseElement: '\u220C',
	NotRightTriangle: '\u22EB',
	NotRightTriangleBar: '\u29D0\u0338',
	NotRightTriangleEqual: '\u22ED',
	NotSquareSubset: '\u228F\u0338',
	NotSquareSubsetEqual: '\u22E2',
	NotSquareSuperset: '\u2290\u0338',
	NotSquareSupersetEqual: '\u22E3',
	NotSubset: '\u2282\u20D2',
	NotSubsetEqual: '\u2288',
	NotSucceeds: '\u2281',
	NotSucceedsEqual: '\u2AB0\u0338',
	NotSucceedsSlantEqual: '\u22E1',
	NotSucceedsTilde: '\u227F\u0338',
	NotSuperset: '\u2283\u20D2',
	NotSupersetEqual: '\u2289',
	NotTilde: '\u2241',
	NotTildeEqual: '\u2244',
	NotTildeFullEqual: '\u2247',
	NotTildeTilde: '\u2249',
	NotVerticalBar: '\u2224',
	npar: '\u2226',
	nparallel: '\u2226',
	nparsl: '\u2AFD\u20E5',
	npart: '\u2202\u0338',
	npolint: '\u2A14',
	npr: '\u2280',
	nprcue: '\u22E0',
	npre: '\u2AAF\u0338',
	nprec: '\u2280',
	npreceq: '\u2AAF\u0338',
	nrArr: '\u21CF',
	nrarr: '\u219B',
	nrarrc: '\u2933\u0338',
	nrarrw: '\u219D\u0338',
	nRightarrow: '\u21CF',
	nrightarrow: '\u219B',
	nrtri: '\u22EB',
	nrtrie: '\u22ED',
	nsc: '\u2281',
	nsccue: '\u22E1',
	nsce: '\u2AB0\u0338',
	Nscr: '\uD835\uDCA9',
	nscr: '\uD835\uDCC3',
	nshortmid: '\u2224',
	nshortparallel: '\u2226',
	nsim: '\u2241',
	nsime: '\u2244',
	nsimeq: '\u2244',
	nsmid: '\u2224',
	nspar: '\u2226',
	nsqsube: '\u22E2',
	nsqsupe: '\u22E3',
	nsub: '\u2284',
	nsubE: '\u2AC5\u0338',
	nsube: '\u2288',
	nsubset: '\u2282\u20D2',
	nsubseteq: '\u2288',
	nsubseteqq: '\u2AC5\u0338',
	nsucc: '\u2281',
	nsucceq: '\u2AB0\u0338',
	nsup: '\u2285',
	nsupE: '\u2AC6\u0338',
	nsupe: '\u2289',
	nsupset: '\u2283\u20D2',
	nsupseteq: '\u2289',
	nsupseteqq: '\u2AC6\u0338',
	ntgl: '\u2279',
	Ntilde: '\u00D1',
	ntilde: '\u00F1',
	ntlg: '\u2278',
	ntriangleleft: '\u22EA',
	ntrianglelefteq: '\u22EC',
	ntriangleright: '\u22EB',
	ntrianglerighteq: '\u22ED',
	Nu: '\u039D',
	nu: '\u03BD',
	num: '\u0023',
	numero: '\u2116',
	numsp: '\u2007',
	nvap: '\u224D\u20D2',
	nVDash: '\u22AF',
	nVdash: '\u22AE',
	nvDash: '\u22AD',
	nvdash: '\u22AC',
	nvge: '\u2265\u20D2',
	nvgt: '\u003E\u20D2',
	nvHarr: '\u2904',
	nvinfin: '\u29DE',
	nvlArr: '\u2902',
	nvle: '\u2264\u20D2',
	nvlt: '\u003C\u20D2',
	nvltrie: '\u22B4\u20D2',
	nvrArr: '\u2903',
	nvrtrie: '\u22B5\u20D2',
	nvsim: '\u223C\u20D2',
	nwarhk: '\u2923',
	nwArr: '\u21D6',
	nwarr: '\u2196',
	nwarrow: '\u2196',
	nwnear: '\u2927',
	Oacute: '\u00D3',
	oacute: '\u00F3',
	oast: '\u229B',
	ocir: '\u229A',
	Ocirc: '\u00D4',
	ocirc: '\u00F4',
	Ocy: '\u041E',
	ocy: '\u043E',
	odash: '\u229D',
	Odblac: '\u0150',
	odblac: '\u0151',
	odiv: '\u2A38',
	odot: '\u2299',
	odsold: '\u29BC',
	OElig: '\u0152',
	oelig: '\u0153',
	ofcir: '\u29BF',
	Ofr: '\uD835\uDD12',
	ofr: '\uD835\uDD2C',
	ogon: '\u02DB',
	Ograve: '\u00D2',
	ograve: '\u00F2',
	ogt: '\u29C1',
	ohbar: '\u29B5',
	ohm: '\u03A9',
	oint: '\u222E',
	olarr: '\u21BA',
	olcir: '\u29BE',
	olcross: '\u29BB',
	oline: '\u203E',
	olt: '\u29C0',
	Omacr: '\u014C',
	omacr: '\u014D',
	Omega: '\u03A9',
	omega: '\u03C9',
	Omicron: '\u039F',
	omicron: '\u03BF',
	omid: '\u29B6',
	ominus: '\u2296',
	Oopf: '\uD835\uDD46',
	oopf: '\uD835\uDD60',
	opar: '\u29B7',
	OpenCurlyDoubleQuote: '\u201C',
	OpenCurlyQuote: '\u2018',
	operp: '\u29B9',
	oplus: '\u2295',
	Or: '\u2A54',
	or: '\u2228',
	orarr: '\u21BB',
	ord: '\u2A5D',
	order: '\u2134',
	orderof: '\u2134',
	ordf: '\u00AA',
	ordm: '\u00BA',
	origof: '\u22B6',
	oror: '\u2A56',
	orslope: '\u2A57',
	orv: '\u2A5B',
	oS: '\u24C8',
	Oscr: '\uD835\uDCAA',
	oscr: '\u2134',
	Oslash: '\u00D8',
	oslash: '\u00F8',
	osol: '\u2298',
	Otilde: '\u00D5',
	otilde: '\u00F5',
	Otimes: '\u2A37',
	otimes: '\u2297',
	otimesas: '\u2A36',
	Ouml: '\u00D6',
	ouml: '\u00F6',
	ovbar: '\u233D',
	OverBar: '\u203E',
	OverBrace: '\u23DE',
	OverBracket: '\u23B4',
	OverParenthesis: '\u23DC',
	par: '\u2225',
	para: '\u00B6',
	parallel: '\u2225',
	parsim: '\u2AF3',
	parsl: '\u2AFD',
	part: '\u2202',
	PartialD: '\u2202',
	Pcy: '\u041F',
	pcy: '\u043F',
	percnt: '\u0025',
	period: '\u002E',
	permil: '\u2030',
	perp: '\u22A5',
	pertenk: '\u2031',
	Pfr: '\uD835\uDD13',
	pfr: '\uD835\uDD2D',
	Phi: '\u03A6',
	phi: '\u03C6',
	phiv: '\u03D5',
	phmmat: '\u2133',
	phone: '\u260E',
	Pi: '\u03A0',
	pi: '\u03C0',
	pitchfork: '\u22D4',
	piv: '\u03D6',
	planck: '\u210F',
	planckh: '\u210E',
	plankv: '\u210F',
	plus: '\u002B',
	plusacir: '\u2A23',
	plusb: '\u229E',
	pluscir: '\u2A22',
	plusdo: '\u2214',
	plusdu: '\u2A25',
	pluse: '\u2A72',
	PlusMinus: '\u00B1',
	plusmn: '\u00B1',
	plussim: '\u2A26',
	plustwo: '\u2A27',
	pm: '\u00B1',
	Poincareplane: '\u210C',
	pointint: '\u2A15',
	Popf: '\u2119',
	popf: '\uD835\uDD61',
	pound: '\u00A3',
	Pr: '\u2ABB',
	pr: '\u227A',
	prap: '\u2AB7',
	prcue: '\u227C',
	prE: '\u2AB3',
	pre: '\u2AAF',
	prec: '\u227A',
	precapprox: '\u2AB7',
	preccurlyeq: '\u227C',
	Precedes: '\u227A',
	PrecedesEqual: '\u2AAF',
	PrecedesSlantEqual: '\u227C',
	PrecedesTilde: '\u227E',
	preceq: '\u2AAF',
	precnapprox: '\u2AB9',
	precneqq: '\u2AB5',
	precnsim: '\u22E8',
	precsim: '\u227E',
	Prime: '\u2033',
	prime: '\u2032',
	primes: '\u2119',
	prnap: '\u2AB9',
	prnE: '\u2AB5',
	prnsim: '\u22E8',
	prod: '\u220F',
	Product: '\u220F',
	profalar: '\u232E',
	profline: '\u2312',
	profsurf: '\u2313',
	prop: '\u221D',
	Proportion: '\u2237',
	Proportional: '\u221D',
	propto: '\u221D',
	prsim: '\u227E',
	prurel: '\u22B0',
	Pscr: '\uD835\uDCAB',
	pscr: '\uD835\uDCC5',
	Psi: '\u03A8',
	psi: '\u03C8',
	puncsp: '\u2008',
	Qfr: '\uD835\uDD14',
	qfr: '\uD835\uDD2E',
	qint: '\u2A0C',
	Qopf: '\u211A',
	qopf: '\uD835\uDD62',
	qprime: '\u2057',
	Qscr: '\uD835\uDCAC',
	qscr: '\uD835\uDCC6',
	quaternions: '\u210D',
	quatint: '\u2A16',
	quest: '\u003F',
	questeq: '\u225F',
	QUOT: '\u0022',
	quot: '\u0022',
	rAarr: '\u21DB',
	race: '\u223D\u0331',
	Racute: '\u0154',
	racute: '\u0155',
	radic: '\u221A',
	raemptyv: '\u29B3',
	Rang: '\u27EB',
	rang: '\u27E9',
	rangd: '\u2992',
	range: '\u29A5',
	rangle: '\u27E9',
	raquo: '\u00BB',
	Rarr: '\u21A0',
	rArr: '\u21D2',
	rarr: '\u2192',
	rarrap: '\u2975',
	rarrb: '\u21E5',
	rarrbfs: '\u2920',
	rarrc: '\u2933',
	rarrfs: '\u291E',
	rarrhk: '\u21AA',
	rarrlp: '\u21AC',
	rarrpl: '\u2945',
	rarrsim: '\u2974',
	Rarrtl: '\u2916',
	rarrtl: '\u21A3',
	rarrw: '\u219D',
	rAtail: '\u291C',
	ratail: '\u291A',
	ratio: '\u2236',
	rationals: '\u211A',
	RBarr: '\u2910',
	rBarr: '\u290F',
	rbarr: '\u290D',
	rbbrk: '\u2773',
	rbrace: '\u007D',
	rbrack: '\u005D',
	rbrke: '\u298C',
	rbrksld: '\u298E',
	rbrkslu: '\u2990',
	Rcaron: '\u0158',
	rcaron: '\u0159',
	Rcedil: '\u0156',
	rcedil: '\u0157',
	rceil: '\u2309',
	rcub: '\u007D',
	Rcy: '\u0420',
	rcy: '\u0440',
	rdca: '\u2937',
	rdldhar: '\u2969',
	rdquo: '\u201D',
	rdquor: '\u201D',
	rdsh: '\u21B3',
	Re: '\u211C',
	real: '\u211C',
	realine: '\u211B',
	realpart: '\u211C',
	reals: '\u211D',
	rect: '\u25AD',
	REG: '\u00AE',
	reg: '\u00AE',
	ReverseElement: '\u220B',
	ReverseEquilibrium: '\u21CB',
	ReverseUpEquilibrium: '\u296F',
	rfisht: '\u297D',
	rfloor: '\u230B',
	Rfr: '\u211C',
	rfr: '\uD835\uDD2F',
	rHar: '\u2964',
	rhard: '\u21C1',
	rharu: '\u21C0',
	rharul: '\u296C',
	Rho: '\u03A1',
	rho: '\u03C1',
	rhov: '\u03F1',
	RightAngleBracket: '\u27E9',
	RightArrow: '\u2192',
	Rightarrow: '\u21D2',
	rightarrow: '\u2192',
	RightArrowBar: '\u21E5',
	RightArrowLeftArrow: '\u21C4',
	rightarrowtail: '\u21A3',
	RightCeiling: '\u2309',
	RightDoubleBracket: '\u27E7',
	RightDownTeeVector: '\u295D',
	RightDownVector: '\u21C2',
	RightDownVectorBar: '\u2955',
	RightFloor: '\u230B',
	rightharpoondown: '\u21C1',
	rightharpoonup: '\u21C0',
	rightleftarrows: '\u21C4',
	rightleftharpoons: '\u21CC',
	rightrightarrows: '\u21C9',
	rightsquigarrow: '\u219D',
	RightTee: '\u22A2',
	RightTeeArrow: '\u21A6',
	RightTeeVector: '\u295B',
	rightthreetimes: '\u22CC',
	RightTriangle: '\u22B3',
	RightTriangleBar: '\u29D0',
	RightTriangleEqual: '\u22B5',
	RightUpDownVector: '\u294F',
	RightUpTeeVector: '\u295C',
	RightUpVector: '\u21BE',
	RightUpVectorBar: '\u2954',
	RightVector: '\u21C0',
	RightVectorBar: '\u2953',
	ring: '\u02DA',
	risingdotseq: '\u2253',
	rlarr: '\u21C4',
	rlhar: '\u21CC',
	rlm: '\u200F',
	rmoust: '\u23B1',
	rmoustache: '\u23B1',
	rnmid: '\u2AEE',
	roang: '\u27ED',
	roarr: '\u21FE',
	robrk: '\u27E7',
	ropar: '\u2986',
	Ropf: '\u211D',
	ropf: '\uD835\uDD63',
	roplus: '\u2A2E',
	rotimes: '\u2A35',
	RoundImplies: '\u2970',
	rpar: '\u0029',
	rpargt: '\u2994',
	rppolint: '\u2A12',
	rrarr: '\u21C9',
	Rrightarrow: '\u21DB',
	rsaquo: '\u203A',
	Rscr: '\u211B',
	rscr: '\uD835\uDCC7',
	Rsh: '\u21B1',
	rsh: '\u21B1',
	rsqb: '\u005D',
	rsquo: '\u2019',
	rsquor: '\u2019',
	rthree: '\u22CC',
	rtimes: '\u22CA',
	rtri: '\u25B9',
	rtrie: '\u22B5',
	rtrif: '\u25B8',
	rtriltri: '\u29CE',
	RuleDelayed: '\u29F4',
	ruluhar: '\u2968',
	rx: '\u211E',
	Sacute: '\u015A',
	sacute: '\u015B',
	sbquo: '\u201A',
	Sc: '\u2ABC',
	sc: '\u227B',
	scap: '\u2AB8',
	Scaron: '\u0160',
	scaron: '\u0161',
	sccue: '\u227D',
	scE: '\u2AB4',
	sce: '\u2AB0',
	Scedil: '\u015E',
	scedil: '\u015F',
	Scirc: '\u015C',
	scirc: '\u015D',
	scnap: '\u2ABA',
	scnE: '\u2AB6',
	scnsim: '\u22E9',
	scpolint: '\u2A13',
	scsim: '\u227F',
	Scy: '\u0421',
	scy: '\u0441',
	sdot: '\u22C5',
	sdotb: '\u22A1',
	sdote: '\u2A66',
	searhk: '\u2925',
	seArr: '\u21D8',
	searr: '\u2198',
	searrow: '\u2198',
	sect: '\u00A7',
	semi: '\u003B',
	seswar: '\u2929',
	setminus: '\u2216',
	setmn: '\u2216',
	sext: '\u2736',
	Sfr: '\uD835\uDD16',
	sfr: '\uD835\uDD30',
	sfrown: '\u2322',
	sharp: '\u266F',
	SHCHcy: '\u0429',
	shchcy: '\u0449',
	SHcy: '\u0428',
	shcy: '\u0448',
	ShortDownArrow: '\u2193',
	ShortLeftArrow: '\u2190',
	shortmid: '\u2223',
	shortparallel: '\u2225',
	ShortRightArrow: '\u2192',
	ShortUpArrow: '\u2191',
	shy: '\u00AD',
	Sigma: '\u03A3',
	sigma: '\u03C3',
	sigmaf: '\u03C2',
	sigmav: '\u03C2',
	sim: '\u223C',
	simdot: '\u2A6A',
	sime: '\u2243',
	simeq: '\u2243',
	simg: '\u2A9E',
	simgE: '\u2AA0',
	siml: '\u2A9D',
	simlE: '\u2A9F',
	simne: '\u2246',
	simplus: '\u2A24',
	simrarr: '\u2972',
	slarr: '\u2190',
	SmallCircle: '\u2218',
	smallsetminus: '\u2216',
	smashp: '\u2A33',
	smeparsl: '\u29E4',
	smid: '\u2223',
	smile: '\u2323',
	smt: '\u2AAA',
	smte: '\u2AAC',
	smtes: '\u2AAC\uFE00',
	SOFTcy: '\u042C',
	softcy: '\u044C',
	sol: '\u002F',
	solb: '\u29C4',
	solbar: '\u233F',
	Sopf: '\uD835\uDD4A',
	sopf: '\uD835\uDD64',
	spades: '\u2660',
	spadesuit: '\u2660',
	spar: '\u2225',
	sqcap: '\u2293',
	sqcaps: '\u2293\uFE00',
	sqcup: '\u2294',
	sqcups: '\u2294\uFE00',
	Sqrt: '\u221A',
	sqsub: '\u228F',
	sqsube: '\u2291',
	sqsubset: '\u228F',
	sqsubseteq: '\u2291',
	sqsup: '\u2290',
	sqsupe: '\u2292',
	sqsupset: '\u2290',
	sqsupseteq: '\u2292',
	squ: '\u25A1',
	Square: '\u25A1',
	square: '\u25A1',
	SquareIntersection: '\u2293',
	SquareSubset: '\u228F',
	SquareSubsetEqual: '\u2291',
	SquareSuperset: '\u2290',
	SquareSupersetEqual: '\u2292',
	SquareUnion: '\u2294',
	squarf: '\u25AA',
	squf: '\u25AA',
	srarr: '\u2192',
	Sscr: '\uD835\uDCAE',
	sscr: '\uD835\uDCC8',
	ssetmn: '\u2216',
	ssmile: '\u2323',
	sstarf: '\u22C6',
	Star: '\u22C6',
	star: '\u2606',
	starf: '\u2605',
	straightepsilon: '\u03F5',
	straightphi: '\u03D5',
	strns: '\u00AF',
	Sub: '\u22D0',
	sub: '\u2282',
	subdot: '\u2ABD',
	subE: '\u2AC5',
	sube: '\u2286',
	subedot: '\u2AC3',
	submult: '\u2AC1',
	subnE: '\u2ACB',
	subne: '\u228A',
	subplus: '\u2ABF',
	subrarr: '\u2979',
	Subset: '\u22D0',
	subset: '\u2282',
	subseteq: '\u2286',
	subseteqq: '\u2AC5',
	SubsetEqual: '\u2286',
	subsetneq: '\u228A',
	subsetneqq: '\u2ACB',
	subsim: '\u2AC7',
	subsub: '\u2AD5',
	subsup: '\u2AD3',
	succ: '\u227B',
	succapprox: '\u2AB8',
	succcurlyeq: '\u227D',
	Succeeds: '\u227B',
	SucceedsEqual: '\u2AB0',
	SucceedsSlantEqual: '\u227D',
	SucceedsTilde: '\u227F',
	succeq: '\u2AB0',
	succnapprox: '\u2ABA',
	succneqq: '\u2AB6',
	succnsim: '\u22E9',
	succsim: '\u227F',
	SuchThat: '\u220B',
	Sum: '\u2211',
	sum: '\u2211',
	sung: '\u266A',
	Sup: '\u22D1',
	sup: '\u2283',
	sup1: '\u00B9',
	sup2: '\u00B2',
	sup3: '\u00B3',
	supdot: '\u2ABE',
	supdsub: '\u2AD8',
	supE: '\u2AC6',
	supe: '\u2287',
	supedot: '\u2AC4',
	Superset: '\u2283',
	SupersetEqual: '\u2287',
	suphsol: '\u27C9',
	suphsub: '\u2AD7',
	suplarr: '\u297B',
	supmult: '\u2AC2',
	supnE: '\u2ACC',
	supne: '\u228B',
	supplus: '\u2AC0',
	Supset: '\u22D1',
	supset: '\u2283',
	supseteq: '\u2287',
	supseteqq: '\u2AC6',
	supsetneq: '\u228B',
	supsetneqq: '\u2ACC',
	supsim: '\u2AC8',
	supsub: '\u2AD4',
	supsup: '\u2AD6',
	swarhk: '\u2926',
	swArr: '\u21D9',
	swarr: '\u2199',
	swarrow: '\u2199',
	swnwar: '\u292A',
	szlig: '\u00DF',
	Tab: '\u0009',
	target: '\u2316',
	Tau: '\u03A4',
	tau: '\u03C4',
	tbrk: '\u23B4',
	Tcaron: '\u0164',
	tcaron: '\u0165',
	Tcedil: '\u0162',
	tcedil: '\u0163',
	Tcy: '\u0422',
	tcy: '\u0442',
	tdot: '\u20DB',
	telrec: '\u2315',
	Tfr: '\uD835\uDD17',
	tfr: '\uD835\uDD31',
	there4: '\u2234',
	Therefore: '\u2234',
	therefore: '\u2234',
	Theta: '\u0398',
	theta: '\u03B8',
	thetasym: '\u03D1',
	thetav: '\u03D1',
	thickapprox: '\u2248',
	thicksim: '\u223C',
	ThickSpace: '\u205F\u200A',
	thinsp: '\u2009',
	ThinSpace: '\u2009',
	thkap: '\u2248',
	thksim: '\u223C',
	THORN: '\u00DE',
	thorn: '\u00FE',
	Tilde: '\u223C',
	tilde: '\u02DC',
	TildeEqual: '\u2243',
	TildeFullEqual: '\u2245',
	TildeTilde: '\u2248',
	times: '\u00D7',
	timesb: '\u22A0',
	timesbar: '\u2A31',
	timesd: '\u2A30',
	tint: '\u222D',
	toea: '\u2928',
	top: '\u22A4',
	topbot: '\u2336',
	topcir: '\u2AF1',
	Topf: '\uD835\uDD4B',
	topf: '\uD835\uDD65',
	topfork: '\u2ADA',
	tosa: '\u2929',
	tprime: '\u2034',
	TRADE: '\u2122',
	trade: '\u2122',
	triangle: '\u25B5',
	triangledown: '\u25BF',
	triangleleft: '\u25C3',
	trianglelefteq: '\u22B4',
	triangleq: '\u225C',
	triangleright: '\u25B9',
	trianglerighteq: '\u22B5',
	tridot: '\u25EC',
	trie: '\u225C',
	triminus: '\u2A3A',
	TripleDot: '\u20DB',
	triplus: '\u2A39',
	trisb: '\u29CD',
	tritime: '\u2A3B',
	trpezium: '\u23E2',
	Tscr: '\uD835\uDCAF',
	tscr: '\uD835\uDCC9',
	TScy: '\u0426',
	tscy: '\u0446',
	TSHcy: '\u040B',
	tshcy: '\u045B',
	Tstrok: '\u0166',
	tstrok: '\u0167',
	twixt: '\u226C',
	twoheadleftarrow: '\u219E',
	twoheadrightarrow: '\u21A0',
	Uacute: '\u00DA',
	uacute: '\u00FA',
	Uarr: '\u219F',
	uArr: '\u21D1',
	uarr: '\u2191',
	Uarrocir: '\u2949',
	Ubrcy: '\u040E',
	ubrcy: '\u045E',
	Ubreve: '\u016C',
	ubreve: '\u016D',
	Ucirc: '\u00DB',
	ucirc: '\u00FB',
	Ucy: '\u0423',
	ucy: '\u0443',
	udarr: '\u21C5',
	Udblac: '\u0170',
	udblac: '\u0171',
	udhar: '\u296E',
	ufisht: '\u297E',
	Ufr: '\uD835\uDD18',
	ufr: '\uD835\uDD32',
	Ugrave: '\u00D9',
	ugrave: '\u00F9',
	uHar: '\u2963',
	uharl: '\u21BF',
	uharr: '\u21BE',
	uhblk: '\u2580',
	ulcorn: '\u231C',
	ulcorner: '\u231C',
	ulcrop: '\u230F',
	ultri: '\u25F8',
	Umacr: '\u016A',
	umacr: '\u016B',
	uml: '\u00A8',
	UnderBar: '\u005F',
	UnderBrace: '\u23DF',
	UnderBracket: '\u23B5',
	UnderParenthesis: '\u23DD',
	Union: '\u22C3',
	UnionPlus: '\u228E',
	Uogon: '\u0172',
	uogon: '\u0173',
	Uopf: '\uD835\uDD4C',
	uopf: '\uD835\uDD66',
	UpArrow: '\u2191',
	Uparrow: '\u21D1',
	uparrow: '\u2191',
	UpArrowBar: '\u2912',
	UpArrowDownArrow: '\u21C5',
	UpDownArrow: '\u2195',
	Updownarrow: '\u21D5',
	updownarrow: '\u2195',
	UpEquilibrium: '\u296E',
	upharpoonleft: '\u21BF',
	upharpoonright: '\u21BE',
	uplus: '\u228E',
	UpperLeftArrow: '\u2196',
	UpperRightArrow: '\u2197',
	Upsi: '\u03D2',
	upsi: '\u03C5',
	upsih: '\u03D2',
	Upsilon: '\u03A5',
	upsilon: '\u03C5',
	UpTee: '\u22A5',
	UpTeeArrow: '\u21A5',
	upuparrows: '\u21C8',
	urcorn: '\u231D',
	urcorner: '\u231D',
	urcrop: '\u230E',
	Uring: '\u016E',
	uring: '\u016F',
	urtri: '\u25F9',
	Uscr: '\uD835\uDCB0',
	uscr: '\uD835\uDCCA',
	utdot: '\u22F0',
	Utilde: '\u0168',
	utilde: '\u0169',
	utri: '\u25B5',
	utrif: '\u25B4',
	uuarr: '\u21C8',
	Uuml: '\u00DC',
	uuml: '\u00FC',
	uwangle: '\u29A7',
	vangrt: '\u299C',
	varepsilon: '\u03F5',
	varkappa: '\u03F0',
	varnothing: '\u2205',
	varphi: '\u03D5',
	varpi: '\u03D6',
	varpropto: '\u221D',
	vArr: '\u21D5',
	varr: '\u2195',
	varrho: '\u03F1',
	varsigma: '\u03C2',
	varsubsetneq: '\u228A\uFE00',
	varsubsetneqq: '\u2ACB\uFE00',
	varsupsetneq: '\u228B\uFE00',
	varsupsetneqq: '\u2ACC\uFE00',
	vartheta: '\u03D1',
	vartriangleleft: '\u22B2',
	vartriangleright: '\u22B3',
	Vbar: '\u2AEB',
	vBar: '\u2AE8',
	vBarv: '\u2AE9',
	Vcy: '\u0412',
	vcy: '\u0432',
	VDash: '\u22AB',
	Vdash: '\u22A9',
	vDash: '\u22A8',
	vdash: '\u22A2',
	Vdashl: '\u2AE6',
	Vee: '\u22C1',
	vee: '\u2228',
	veebar: '\u22BB',
	veeeq: '\u225A',
	vellip: '\u22EE',
	Verbar: '\u2016',
	verbar: '\u007C',
	Vert: '\u2016',
	vert: '\u007C',
	VerticalBar: '\u2223',
	VerticalLine: '\u007C',
	VerticalSeparator: '\u2758',
	VerticalTilde: '\u2240',
	VeryThinSpace: '\u200A',
	Vfr: '\uD835\uDD19',
	vfr: '\uD835\uDD33',
	vltri: '\u22B2',
	vnsub: '\u2282\u20D2',
	vnsup: '\u2283\u20D2',
	Vopf: '\uD835\uDD4D',
	vopf: '\uD835\uDD67',
	vprop: '\u221D',
	vrtri: '\u22B3',
	Vscr: '\uD835\uDCB1',
	vscr: '\uD835\uDCCB',
	vsubnE: '\u2ACB\uFE00',
	vsubne: '\u228A\uFE00',
	vsupnE: '\u2ACC\uFE00',
	vsupne: '\u228B\uFE00',
	Vvdash: '\u22AA',
	vzigzag: '\u299A',
	Wcirc: '\u0174',
	wcirc: '\u0175',
	wedbar: '\u2A5F',
	Wedge: '\u22C0',
	wedge: '\u2227',
	wedgeq: '\u2259',
	weierp: '\u2118',
	Wfr: '\uD835\uDD1A',
	wfr: '\uD835\uDD34',
	Wopf: '\uD835\uDD4E',
	wopf: '\uD835\uDD68',
	wp: '\u2118',
	wr: '\u2240',
	wreath: '\u2240',
	Wscr: '\uD835\uDCB2',
	wscr: '\uD835\uDCCC',
	xcap: '\u22C2',
	xcirc: '\u25EF',
	xcup: '\u22C3',
	xdtri: '\u25BD',
	Xfr: '\uD835\uDD1B',
	xfr: '\uD835\uDD35',
	xhArr: '\u27FA',
	xharr: '\u27F7',
	Xi: '\u039E',
	xi: '\u03BE',
	xlArr: '\u27F8',
	xlarr: '\u27F5',
	xmap: '\u27FC',
	xnis: '\u22FB',
	xodot: '\u2A00',
	Xopf: '\uD835\uDD4F',
	xopf: '\uD835\uDD69',
	xoplus: '\u2A01',
	xotime: '\u2A02',
	xrArr: '\u27F9',
	xrarr: '\u27F6',
	Xscr: '\uD835\uDCB3',
	xscr: '\uD835\uDCCD',
	xsqcup: '\u2A06',
	xuplus: '\u2A04',
	xutri: '\u25B3',
	xvee: '\u22C1',
	xwedge: '\u22C0',
	Yacute: '\u00DD',
	yacute: '\u00FD',
	YAcy: '\u042F',
	yacy: '\u044F',
	Ycirc: '\u0176',
	ycirc: '\u0177',
	Ycy: '\u042B',
	ycy: '\u044B',
	yen: '\u00A5',
	Yfr: '\uD835\uDD1C',
	yfr: '\uD835\uDD36',
	YIcy: '\u0407',
	yicy: '\u0457',
	Yopf: '\uD835\uDD50',
	yopf: '\uD835\uDD6A',
	Yscr: '\uD835\uDCB4',
	yscr: '\uD835\uDCCE',
	YUcy: '\u042E',
	yucy: '\u044E',
	Yuml: '\u0178',
	yuml: '\u00FF',
	Zacute: '\u0179',
	zacute: '\u017A',
	Zcaron: '\u017D',
	zcaron: '\u017E',
	Zcy: '\u0417',
	zcy: '\u0437',
	Zdot: '\u017B',
	zdot: '\u017C',
	zeetrf: '\u2128',
	ZeroWidthSpace: '\u200B',
	Zeta: '\u0396',
	zeta: '\u03B6',
	Zfr: '\u2128',
	zfr: '\uD835\uDD37',
	ZHcy: '\u0416',
	zhcy: '\u0436',
	zigrarr: '\u21DD',
	Zopf: '\u2124',
	zopf: '\uD835\uDD6B',
	Zscr: '\uD835\uDCB5',
	zscr: '\uD835\uDCCF',
	zwj: '\u200D',
	zwnj: '\u200C',
});

/**
 * @deprecated use `HTML_ENTITIES` instead
 * @see HTML_ENTITIES
 */
exports.entityMap = exports.HTML_ENTITIES;


/***/ }),

/***/ 28978:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var dom = __webpack_require__(84722)
exports.DOMImplementation = dom.DOMImplementation
exports.XMLSerializer = dom.XMLSerializer
exports.DOMParser = __webpack_require__(15752).DOMParser


/***/ }),

/***/ 64466:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var NAMESPACE = (__webpack_require__(44582).NAMESPACE);

//[4]   	NameStartChar	   ::=   	":" | [A-Z] | "_" | [a-z] | [#xC0-#xD6] | [#xD8-#xF6] | [#xF8-#x2FF] | [#x370-#x37D] | [#x37F-#x1FFF] | [#x200C-#x200D] | [#x2070-#x218F] | [#x2C00-#x2FEF] | [#x3001-#xD7FF] | [#xF900-#xFDCF] | [#xFDF0-#xFFFD] | [#x10000-#xEFFFF]
//[4a]   	NameChar	   ::=   	NameStartChar | "-" | "." | [0-9] | #xB7 | [#x0300-#x036F] | [#x203F-#x2040]
//[5]   	Name	   ::=   	NameStartChar (NameChar)*
var nameStartChar = /[A-Z_a-z\xC0-\xD6\xD8-\xF6\u00F8-\u02FF\u0370-\u037D\u037F-\u1FFF\u200C-\u200D\u2070-\u218F\u2C00-\u2FEF\u3001-\uD7FF\uF900-\uFDCF\uFDF0-\uFFFD]///\u10000-\uEFFFF
var nameChar = new RegExp("[\\-\\.0-9"+nameStartChar.source.slice(1,-1)+"\\u00B7\\u0300-\\u036F\\u203F-\\u2040]");
var tagNamePattern = new RegExp('^'+nameStartChar.source+nameChar.source+'*(?:\:'+nameStartChar.source+nameChar.source+'*)?$');
//var tagNamePattern = /^[a-zA-Z_][\w\-\.]*(?:\:[a-zA-Z_][\w\-\.]*)?$/
//var handlers = 'resolveEntity,getExternalSubset,characters,endDocument,endElement,endPrefixMapping,ignorableWhitespace,processingInstruction,setDocumentLocator,skippedEntity,startDocument,startElement,startPrefixMapping,notationDecl,unparsedEntityDecl,error,fatalError,warning,attributeDecl,elementDecl,externalEntityDecl,internalEntityDecl,comment,endCDATA,endDTD,endEntity,startCDATA,startDTD,startEntity'.split(',')

//S_TAG,	S_ATTR,	S_EQ,	S_ATTR_NOQUOT_VALUE
//S_ATTR_SPACE,	S_ATTR_END,	S_TAG_SPACE, S_TAG_CLOSE
var S_TAG = 0;//tag name offerring
var S_ATTR = 1;//attr name offerring
var S_ATTR_SPACE=2;//attr name end and space offer
var S_EQ = 3;//=space?
var S_ATTR_NOQUOT_VALUE = 4;//attr value(no quot value only)
var S_ATTR_END = 5;//attr value end and no space(quot end)
var S_TAG_SPACE = 6;//(attr value end || tag end ) && (space offer)
var S_TAG_CLOSE = 7;//closed el<el />

/**
 * Creates an error that will not be caught by XMLReader aka the SAX parser.
 *
 * @param {string} message
 * @param {any?} locator Optional, can provide details about the location in the source
 * @constructor
 */
function ParseError(message, locator) {
	this.message = message
	this.locator = locator
	if(Error.captureStackTrace) Error.captureStackTrace(this, ParseError);
}
ParseError.prototype = new Error();
ParseError.prototype.name = ParseError.name

function XMLReader(){

}

XMLReader.prototype = {
	parse:function(source,defaultNSMap,entityMap){
		var domBuilder = this.domBuilder;
		domBuilder.startDocument();
		_copy(defaultNSMap ,defaultNSMap = {})
		parse(source,defaultNSMap,entityMap,
				domBuilder,this.errorHandler);
		domBuilder.endDocument();
	}
}
function parse(source,defaultNSMapCopy,entityMap,domBuilder,errorHandler){
	function fixedFromCharCode(code) {
		// String.prototype.fromCharCode does not supports
		// > 2 bytes unicode chars directly
		if (code > 0xffff) {
			code -= 0x10000;
			var surrogate1 = 0xd800 + (code >> 10)
				, surrogate2 = 0xdc00 + (code & 0x3ff);

			return String.fromCharCode(surrogate1, surrogate2);
		} else {
			return String.fromCharCode(code);
		}
	}
	function entityReplacer(a){
		var k = a.slice(1,-1);
		if (Object.hasOwnProperty.call(entityMap, k)) {
			return entityMap[k];
		}else if(k.charAt(0) === '#'){
			return fixedFromCharCode(parseInt(k.substr(1).replace('x','0x')))
		}else{
			errorHandler.error('entity not found:'+a);
			return a;
		}
	}
	function appendText(end){//has some bugs
		if(end>start){
			var xt = source.substring(start,end).replace(/&#?\w+;/g,entityReplacer);
			locator&&position(start);
			domBuilder.characters(xt,0,end-start);
			start = end
		}
	}
	function position(p,m){
		while(p>=lineEnd && (m = linePattern.exec(source))){
			lineStart = m.index;
			lineEnd = lineStart + m[0].length;
			locator.lineNumber++;
			//console.log('line++:',locator,startPos,endPos)
		}
		locator.columnNumber = p-lineStart+1;
	}
	var lineStart = 0;
	var lineEnd = 0;
	var linePattern = /.*(?:\r\n?|\n)|.*$/g
	var locator = domBuilder.locator;

	var parseStack = [{currentNSMap:defaultNSMapCopy}]
	var closeMap = {};
	var start = 0;
	while(true){
		try{
			var tagStart = source.indexOf('<',start);
			if(tagStart<0){
				if(!source.substr(start).match(/^\s*$/)){
					var doc = domBuilder.doc;
	    			var text = doc.createTextNode(source.substr(start));
	    			doc.appendChild(text);
	    			domBuilder.currentElement = text;
				}
				return;
			}
			if(tagStart>start){
				appendText(tagStart);
			}
			switch(source.charAt(tagStart+1)){
			case '/':
				var end = source.indexOf('>',tagStart+3);
				var tagName = source.substring(tagStart + 2, end).replace(/[ \t\n\r]+$/g, '');
				var config = parseStack.pop();
				if(end<0){

	        		tagName = source.substring(tagStart+2).replace(/[\s<].*/,'');
	        		errorHandler.error("end tag name: "+tagName+' is not complete:'+config.tagName);
	        		end = tagStart+1+tagName.length;
	        	}else if(tagName.match(/\s</)){
	        		tagName = tagName.replace(/[\s<].*/,'');
	        		errorHandler.error("end tag name: "+tagName+' maybe not complete');
	        		end = tagStart+1+tagName.length;
				}
				var localNSMap = config.localNSMap;
				var endMatch = config.tagName == tagName;
				var endIgnoreCaseMach = endMatch || config.tagName&&config.tagName.toLowerCase() == tagName.toLowerCase()
		        if(endIgnoreCaseMach){
		        	domBuilder.endElement(config.uri,config.localName,tagName);
					if(localNSMap){
						for (var prefix in localNSMap) {
							if (Object.prototype.hasOwnProperty.call(localNSMap, prefix)) {
								domBuilder.endPrefixMapping(prefix);
							}
						}
					}
					if(!endMatch){
		            	errorHandler.fatalError("end tag name: "+tagName+' is not match the current start tagName:'+config.tagName ); // No known test case
					}
		        }else{
		        	parseStack.push(config)
		        }

				end++;
				break;
				// end elment
			case '?':// <?...?>
				locator&&position(tagStart);
				end = parseInstruction(source,tagStart,domBuilder);
				break;
			case '!':// <!doctype,<![CDATA,<!--
				locator&&position(tagStart);
				end = parseDCC(source,tagStart,domBuilder,errorHandler);
				break;
			default:
				locator&&position(tagStart);
				var el = new ElementAttributes();
				var currentNSMap = parseStack[parseStack.length-1].currentNSMap;
				//elStartEnd
				var end = parseElementStartPart(source,tagStart,el,currentNSMap,entityReplacer,errorHandler);
				var len = el.length;


				if(!el.closed && fixSelfClosed(source,end,el.tagName,closeMap)){
					el.closed = true;
					if(!entityMap.nbsp){
						errorHandler.warning('unclosed xml attribute');
					}
				}
				if(locator && len){
					var locator2 = copyLocator(locator,{});
					//try{//attribute position fixed
					for(var i = 0;i<len;i++){
						var a = el[i];
						position(a.offset);
						a.locator = copyLocator(locator,{});
					}
					domBuilder.locator = locator2
					if(appendElement(el,domBuilder,currentNSMap)){
						parseStack.push(el)
					}
					domBuilder.locator = locator;
				}else{
					if(appendElement(el,domBuilder,currentNSMap)){
						parseStack.push(el)
					}
				}

				if (NAMESPACE.isHTML(el.uri) && !el.closed) {
					end = parseHtmlSpecialContent(source,end,el.tagName,entityReplacer,domBuilder)
				} else {
					end++;
				}
			}
		}catch(e){
			if (e instanceof ParseError) {
				throw e;
			}
			errorHandler.error('element parse error: '+e)
			end = -1;
		}
		if(end>start){
			start = end;
		}else{
			//TODO: 这里有可能sax回退，有位置错误风险
			appendText(Math.max(tagStart,start)+1);
		}
	}
}
function copyLocator(f,t){
	t.lineNumber = f.lineNumber;
	t.columnNumber = f.columnNumber;
	return t;
}

/**
 * @see #appendElement(source,elStartEnd,el,selfClosed,entityReplacer,domBuilder,parseStack);
 * @return end of the elementStartPart(end of elementEndPart for selfClosed el)
 */
function parseElementStartPart(source,start,el,currentNSMap,entityReplacer,errorHandler){

	/**
	 * @param {string} qname
	 * @param {string} value
	 * @param {number} startIndex
	 */
	function addAttribute(qname, value, startIndex) {
		if (el.attributeNames.hasOwnProperty(qname)) {
			errorHandler.fatalError('Attribute ' + qname + ' redefined')
		}
		el.addValue(
			qname,
			// @see https://www.w3.org/TR/xml/#AVNormalize
			// since the xmldom sax parser does not "interpret" DTD the following is not implemented:
			// - recursive replacement of (DTD) entity references
			// - trimming and collapsing multiple spaces into a single one for attributes that are not of type CDATA
			value.replace(/[\t\n\r]/g, ' ').replace(/&#?\w+;/g, entityReplacer),
			startIndex
		)
	}
	var attrName;
	var value;
	var p = ++start;
	var s = S_TAG;//status
	while(true){
		var c = source.charAt(p);
		switch(c){
		case '=':
			if(s === S_ATTR){//attrName
				attrName = source.slice(start,p);
				s = S_EQ;
			}else if(s === S_ATTR_SPACE){
				s = S_EQ;
			}else{
				//fatalError: equal must after attrName or space after attrName
				throw new Error('attribute equal must after attrName'); // No known test case
			}
			break;
		case '\'':
		case '"':
			if(s === S_EQ || s === S_ATTR //|| s == S_ATTR_SPACE
				){//equal
				if(s === S_ATTR){
					errorHandler.warning('attribute value must after "="')
					attrName = source.slice(start,p)
				}
				start = p+1;
				p = source.indexOf(c,start)
				if(p>0){
					value = source.slice(start, p);
					addAttribute(attrName, value, start-1);
					s = S_ATTR_END;
				}else{
					//fatalError: no end quot match
					throw new Error('attribute value no end \''+c+'\' match');
				}
			}else if(s == S_ATTR_NOQUOT_VALUE){
				value = source.slice(start, p);
				addAttribute(attrName, value, start);
				errorHandler.warning('attribute "'+attrName+'" missed start quot('+c+')!!');
				start = p+1;
				s = S_ATTR_END
			}else{
				//fatalError: no equal before
				throw new Error('attribute value must after "="'); // No known test case
			}
			break;
		case '/':
			switch(s){
			case S_TAG:
				el.setTagName(source.slice(start,p));
			case S_ATTR_END:
			case S_TAG_SPACE:
			case S_TAG_CLOSE:
				s =S_TAG_CLOSE;
				el.closed = true;
			case S_ATTR_NOQUOT_VALUE:
			case S_ATTR:
				break;
				case S_ATTR_SPACE:
					el.closed = true;
				break;
			//case S_EQ:
			default:
				throw new Error("attribute invalid close char('/')") // No known test case
			}
			break;
		case ''://end document
			errorHandler.error('unexpected end of input');
			if(s == S_TAG){
				el.setTagName(source.slice(start,p));
			}
			return p;
		case '>':
			switch(s){
			case S_TAG:
				el.setTagName(source.slice(start,p));
			case S_ATTR_END:
			case S_TAG_SPACE:
			case S_TAG_CLOSE:
				break;//normal
			case S_ATTR_NOQUOT_VALUE://Compatible state
			case S_ATTR:
				value = source.slice(start,p);
				if(value.slice(-1) === '/'){
					el.closed  = true;
					value = value.slice(0,-1)
				}
			case S_ATTR_SPACE:
				if(s === S_ATTR_SPACE){
					value = attrName;
				}
				if(s == S_ATTR_NOQUOT_VALUE){
					errorHandler.warning('attribute "'+value+'" missed quot(")!');
					addAttribute(attrName, value, start)
				}else{
					if(!NAMESPACE.isHTML(currentNSMap['']) || !value.match(/^(?:disabled|checked|selected)$/i)){
						errorHandler.warning('attribute "'+value+'" missed value!! "'+value+'" instead!!')
					}
					addAttribute(value, value, start)
				}
				break;
			case S_EQ:
				throw new Error('attribute value missed!!');
			}
//			console.log(tagName,tagNamePattern,tagNamePattern.test(tagName))
			return p;
		/*xml space '\x20' | #x9 | #xD | #xA; */
		case '\u0080':
			c = ' ';
		default:
			if(c<= ' '){//space
				switch(s){
				case S_TAG:
					el.setTagName(source.slice(start,p));//tagName
					s = S_TAG_SPACE;
					break;
				case S_ATTR:
					attrName = source.slice(start,p)
					s = S_ATTR_SPACE;
					break;
				case S_ATTR_NOQUOT_VALUE:
					var value = source.slice(start, p);
					errorHandler.warning('attribute "'+value+'" missed quot(")!!');
					addAttribute(attrName, value, start)
				case S_ATTR_END:
					s = S_TAG_SPACE;
					break;
				//case S_TAG_SPACE:
				//case S_EQ:
				//case S_ATTR_SPACE:
				//	void();break;
				//case S_TAG_CLOSE:
					//ignore warning
				}
			}else{//not space
//S_TAG,	S_ATTR,	S_EQ,	S_ATTR_NOQUOT_VALUE
//S_ATTR_SPACE,	S_ATTR_END,	S_TAG_SPACE, S_TAG_CLOSE
				switch(s){
				//case S_TAG:void();break;
				//case S_ATTR:void();break;
				//case S_ATTR_NOQUOT_VALUE:void();break;
				case S_ATTR_SPACE:
					var tagName =  el.tagName;
					if (!NAMESPACE.isHTML(currentNSMap['']) || !attrName.match(/^(?:disabled|checked|selected)$/i)) {
						errorHandler.warning('attribute "'+attrName+'" missed value!! "'+attrName+'" instead2!!')
					}
					addAttribute(attrName, attrName, start);
					start = p;
					s = S_ATTR;
					break;
				case S_ATTR_END:
					errorHandler.warning('attribute space is required"'+attrName+'"!!')
				case S_TAG_SPACE:
					s = S_ATTR;
					start = p;
					break;
				case S_EQ:
					s = S_ATTR_NOQUOT_VALUE;
					start = p;
					break;
				case S_TAG_CLOSE:
					throw new Error("elements closed character '/' and '>' must be connected to");
				}
			}
		}//end outer switch
		//console.log('p++',p)
		p++;
	}
}
/**
 * @return true if has new namespace define
 */
function appendElement(el,domBuilder,currentNSMap){
	var tagName = el.tagName;
	var localNSMap = null;
	//var currentNSMap = parseStack[parseStack.length-1].currentNSMap;
	var i = el.length;
	while(i--){
		var a = el[i];
		var qName = a.qName;
		var value = a.value;
		var nsp = qName.indexOf(':');
		if(nsp>0){
			var prefix = a.prefix = qName.slice(0,nsp);
			var localName = qName.slice(nsp+1);
			var nsPrefix = prefix === 'xmlns' && localName
		}else{
			localName = qName;
			prefix = null
			nsPrefix = qName === 'xmlns' && ''
		}
		//can not set prefix,because prefix !== ''
		a.localName = localName ;
		//prefix == null for no ns prefix attribute
		if(nsPrefix !== false){//hack!!
			if(localNSMap == null){
				localNSMap = {}
				//console.log(currentNSMap,0)
				_copy(currentNSMap,currentNSMap={})
				//console.log(currentNSMap,1)
			}
			currentNSMap[nsPrefix] = localNSMap[nsPrefix] = value;
			a.uri = NAMESPACE.XMLNS
			domBuilder.startPrefixMapping(nsPrefix, value)
		}
	}
	var i = el.length;
	while(i--){
		a = el[i];
		var prefix = a.prefix;
		if(prefix){//no prefix attribute has no namespace
			if(prefix === 'xml'){
				a.uri = NAMESPACE.XML;
			}if(prefix !== 'xmlns'){
				a.uri = currentNSMap[prefix || '']

				//{console.log('###'+a.qName,domBuilder.locator.systemId+'',currentNSMap,a.uri)}
			}
		}
	}
	var nsp = tagName.indexOf(':');
	if(nsp>0){
		prefix = el.prefix = tagName.slice(0,nsp);
		localName = el.localName = tagName.slice(nsp+1);
	}else{
		prefix = null;//important!!
		localName = el.localName = tagName;
	}
	//no prefix element has default namespace
	var ns = el.uri = currentNSMap[prefix || ''];
	domBuilder.startElement(ns,localName,tagName,el);
	//endPrefixMapping and startPrefixMapping have not any help for dom builder
	//localNSMap = null
	if(el.closed){
		domBuilder.endElement(ns,localName,tagName);
		if(localNSMap){
			for (prefix in localNSMap) {
				if (Object.prototype.hasOwnProperty.call(localNSMap, prefix)) {
					domBuilder.endPrefixMapping(prefix);
				}
			}
		}
	}else{
		el.currentNSMap = currentNSMap;
		el.localNSMap = localNSMap;
		//parseStack.push(el);
		return true;
	}
}
function parseHtmlSpecialContent(source,elStartEnd,tagName,entityReplacer,domBuilder){
	if(/^(?:script|textarea)$/i.test(tagName)){
		var elEndStart =  source.indexOf('</'+tagName+'>',elStartEnd);
		var text = source.substring(elStartEnd+1,elEndStart);
		if(/[&<]/.test(text)){
			if(/^script$/i.test(tagName)){
				//if(!/\]\]>/.test(text)){
					//lexHandler.startCDATA();
					domBuilder.characters(text,0,text.length);
					//lexHandler.endCDATA();
					return elEndStart;
				//}
			}//}else{//text area
				text = text.replace(/&#?\w+;/g,entityReplacer);
				domBuilder.characters(text,0,text.length);
				return elEndStart;
			//}

		}
	}
	return elStartEnd+1;
}
function fixSelfClosed(source,elStartEnd,tagName,closeMap){
	//if(tagName in closeMap){
	var pos = closeMap[tagName];
	if(pos == null){
		//console.log(tagName)
		pos =  source.lastIndexOf('</'+tagName+'>')
		if(pos<elStartEnd){//忘记闭合
			pos = source.lastIndexOf('</'+tagName)
		}
		closeMap[tagName] =pos
	}
	return pos<elStartEnd;
	//}
}

function _copy (source, target) {
	for (var n in source) {
		if (Object.prototype.hasOwnProperty.call(source, n)) {
			target[n] = source[n];
		}
	}
}

function parseDCC(source,start,domBuilder,errorHandler){//sure start with '<!'
	var next= source.charAt(start+2)
	switch(next){
	case '-':
		if(source.charAt(start + 3) === '-'){
			var end = source.indexOf('-->',start+4);
			//append comment source.substring(4,end)//<!--
			if(end>start){
				domBuilder.comment(source,start+4,end-start-4);
				return end+3;
			}else{
				errorHandler.error("Unclosed comment");
				return -1;
			}
		}else{
			//error
			return -1;
		}
	default:
		if(source.substr(start+3,6) == 'CDATA['){
			var end = source.indexOf(']]>',start+9);
			domBuilder.startCDATA();
			domBuilder.characters(source,start+9,end-start-9);
			domBuilder.endCDATA()
			return end+3;
		}
		//<!DOCTYPE
		//startDTD(java.lang.String name, java.lang.String publicId, java.lang.String systemId)
		var matchs = split(source,start);
		var len = matchs.length;
		if(len>1 && /!doctype/i.test(matchs[0][0])){
			var name = matchs[1][0];
			var pubid = false;
			var sysid = false;
			if(len>3){
				if(/^public$/i.test(matchs[2][0])){
					pubid = matchs[3][0];
					sysid = len>4 && matchs[4][0];
				}else if(/^system$/i.test(matchs[2][0])){
					sysid = matchs[3][0];
				}
			}
			var lastMatch = matchs[len-1]
			domBuilder.startDTD(name, pubid, sysid);
			domBuilder.endDTD();

			return lastMatch.index+lastMatch[0].length
		}
	}
	return -1;
}



function parseInstruction(source,start,domBuilder){
	var end = source.indexOf('?>',start);
	if(end){
		var match = source.substring(start,end).match(/^<\?(\S*)\s*([\s\S]*?)$/);
		if(match){
			var len = match[0].length;
			domBuilder.processingInstruction(match[1], match[2]) ;
			return end+2;
		}else{//error
			return -1;
		}
	}
	return -1;
}

function ElementAttributes(){
	this.attributeNames = {}
}
ElementAttributes.prototype = {
	setTagName:function(tagName){
		if(!tagNamePattern.test(tagName)){
			throw new Error('invalid tagName:'+tagName)
		}
		this.tagName = tagName
	},
	addValue:function(qName, value, offset) {
		if(!tagNamePattern.test(qName)){
			throw new Error('invalid attribute:'+qName)
		}
		this.attributeNames[qName] = this.length;
		this[this.length++] = {qName:qName,value:value,offset:offset}
	},
	length:0,
	getLocalName:function(i){return this[i].localName},
	getLocator:function(i){return this[i].locator},
	getQName:function(i){return this[i].qName},
	getURI:function(i){return this[i].uri},
	getValue:function(i){return this[i].value}
//	,getIndex:function(uri, localName)){
//		if(localName){
//
//		}else{
//			var qName = uri
//		}
//	},
//	getValue:function(){return this.getValue(this.getIndex.apply(this,arguments))},
//	getType:function(uri,localName){}
//	getType:function(i){},
}



function split(source,start){
	var match;
	var buf = [];
	var reg = /'[^']+'|"[^"]+"|[^\s<>\/=]+=?|(\/?\s*>|<)/g;
	reg.lastIndex = start;
	reg.exec(source);//skip <
	while(match = reg.exec(source)){
		buf.push(match);
		if(match[1])return buf;
	}
}

exports.XMLReader = XMLReader;
exports.ParseError = ParseError;


/***/ }),

/***/ 67526:
/***/ (function(__unused_webpack_module, exports) {

"use strict";


exports.byteLength = byteLength
exports.toByteArray = toByteArray
exports.fromByteArray = fromByteArray

var lookup = []
var revLookup = []
var Arr = typeof Uint8Array !== 'undefined' ? Uint8Array : Array

var code = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
for (var i = 0, len = code.length; i < len; ++i) {
  lookup[i] = code[i]
  revLookup[code.charCodeAt(i)] = i
}

// Support decoding URL-safe base64 strings, as Node.js does.
// See: https://en.wikipedia.org/wiki/Base64#URL_applications
revLookup['-'.charCodeAt(0)] = 62
revLookup['_'.charCodeAt(0)] = 63

function getLens (b64) {
  var len = b64.length

  if (len % 4 > 0) {
    throw new Error('Invalid string. Length must be a multiple of 4')
  }

  // Trim off extra bytes after placeholder bytes are found
  // See: https://github.com/beatgammit/base64-js/issues/42
  var validLen = b64.indexOf('=')
  if (validLen === -1) validLen = len

  var placeHoldersLen = validLen === len
    ? 0
    : 4 - (validLen % 4)

  return [validLen, placeHoldersLen]
}

// base64 is 4/3 + up to two characters of the original data
function byteLength (b64) {
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function _byteLength (b64, validLen, placeHoldersLen) {
  return ((validLen + placeHoldersLen) * 3 / 4) - placeHoldersLen
}

function toByteArray (b64) {
  var tmp
  var lens = getLens(b64)
  var validLen = lens[0]
  var placeHoldersLen = lens[1]

  var arr = new Arr(_byteLength(b64, validLen, placeHoldersLen))

  var curByte = 0

  // if there are placeholders, only get up to the last complete 4 chars
  var len = placeHoldersLen > 0
    ? validLen - 4
    : validLen

  var i
  for (i = 0; i < len; i += 4) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 18) |
      (revLookup[b64.charCodeAt(i + 1)] << 12) |
      (revLookup[b64.charCodeAt(i + 2)] << 6) |
      revLookup[b64.charCodeAt(i + 3)]
    arr[curByte++] = (tmp >> 16) & 0xFF
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 2) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 2) |
      (revLookup[b64.charCodeAt(i + 1)] >> 4)
    arr[curByte++] = tmp & 0xFF
  }

  if (placeHoldersLen === 1) {
    tmp =
      (revLookup[b64.charCodeAt(i)] << 10) |
      (revLookup[b64.charCodeAt(i + 1)] << 4) |
      (revLookup[b64.charCodeAt(i + 2)] >> 2)
    arr[curByte++] = (tmp >> 8) & 0xFF
    arr[curByte++] = tmp & 0xFF
  }

  return arr
}

function tripletToBase64 (num) {
  return lookup[num >> 18 & 0x3F] +
    lookup[num >> 12 & 0x3F] +
    lookup[num >> 6 & 0x3F] +
    lookup[num & 0x3F]
}

function encodeChunk (uint8, start, end) {
  var tmp
  var output = []
  for (var i = start; i < end; i += 3) {
    tmp =
      ((uint8[i] << 16) & 0xFF0000) +
      ((uint8[i + 1] << 8) & 0xFF00) +
      (uint8[i + 2] & 0xFF)
    output.push(tripletToBase64(tmp))
  }
  return output.join('')
}

function fromByteArray (uint8) {
  var tmp
  var len = uint8.length
  var extraBytes = len % 3 // if we have 1 byte left, pad 2 bytes
  var parts = []
  var maxChunkLength = 16383 // must be multiple of 3

  // go through the array every three bytes, we'll deal with trailing stuff later
  for (var i = 0, len2 = len - extraBytes; i < len2; i += maxChunkLength) {
    parts.push(encodeChunk(uint8, i, (i + maxChunkLength) > len2 ? len2 : (i + maxChunkLength)))
  }

  // pad the end with zeros, but make sure to not forget the extra bytes
  if (extraBytes === 1) {
    tmp = uint8[len - 1]
    parts.push(
      lookup[tmp >> 2] +
      lookup[(tmp << 4) & 0x3F] +
      '=='
    )
  } else if (extraBytes === 2) {
    tmp = (uint8[len - 2] << 8) + uint8[len - 1]
    parts.push(
      lookup[tmp >> 10] +
      lookup[(tmp >> 4) & 0x3F] +
      lookup[(tmp << 2) & 0x3F] +
      '='
    )
  }

  return parts.join('')
}


/***/ }),

/***/ 27945:
/***/ (function(__unused_webpack_module, exports) {

"use strict";

Object.defineProperty(exports, "__esModule", ({ value: true }));
var dingbats = [
    { "Typeface name": "Symbol", "Dingbat dec": "32", "Dingbat hex": "20", "Unicode dec": "32", "Unicode hex": "20" },
    { "Typeface name": "Symbol", "Dingbat dec": "33", "Dingbat hex": "21", "Unicode dec": "33", "Unicode hex": "21" },
    { "Typeface name": "Symbol", "Dingbat dec": "34", "Dingbat hex": "22", "Unicode dec": "8704", "Unicode hex": "2200" },
    { "Typeface name": "Symbol", "Dingbat dec": "35", "Dingbat hex": "23", "Unicode dec": "35", "Unicode hex": "23" },
    { "Typeface name": "Symbol", "Dingbat dec": "36", "Dingbat hex": "24", "Unicode dec": "8707", "Unicode hex": "2203" },
    { "Typeface name": "Symbol", "Dingbat dec": "37", "Dingbat hex": "25", "Unicode dec": "37", "Unicode hex": "25" },
    { "Typeface name": "Symbol", "Dingbat dec": "38", "Dingbat hex": "26", "Unicode dec": "38", "Unicode hex": "26" },
    { "Typeface name": "Symbol", "Dingbat dec": "39", "Dingbat hex": "27", "Unicode dec": "8717", "Unicode hex": "220D" },
    { "Typeface name": "Symbol", "Dingbat dec": "40", "Dingbat hex": "28", "Unicode dec": "40", "Unicode hex": "28" },
    { "Typeface name": "Symbol", "Dingbat dec": "41", "Dingbat hex": "29", "Unicode dec": "41", "Unicode hex": "29" },
    { "Typeface name": "Symbol", "Dingbat dec": "42", "Dingbat hex": "2A", "Unicode dec": "42", "Unicode hex": "2A" },
    { "Typeface name": "Symbol", "Dingbat dec": "43", "Dingbat hex": "2B", "Unicode dec": "43", "Unicode hex": "2B" },
    { "Typeface name": "Symbol", "Dingbat dec": "44", "Dingbat hex": "2C", "Unicode dec": "44", "Unicode hex": "2C" },
    { "Typeface name": "Symbol", "Dingbat dec": "45", "Dingbat hex": "2D", "Unicode dec": "8722", "Unicode hex": "2212" },
    { "Typeface name": "Symbol", "Dingbat dec": "46", "Dingbat hex": "2E", "Unicode dec": "46", "Unicode hex": "2E" },
    { "Typeface name": "Symbol", "Dingbat dec": "47", "Dingbat hex": "2F", "Unicode dec": "47", "Unicode hex": "2F" },
    { "Typeface name": "Symbol", "Dingbat dec": "48", "Dingbat hex": "30", "Unicode dec": "48", "Unicode hex": "30" },
    { "Typeface name": "Symbol", "Dingbat dec": "49", "Dingbat hex": "31", "Unicode dec": "49", "Unicode hex": "31" },
    { "Typeface name": "Symbol", "Dingbat dec": "50", "Dingbat hex": "32", "Unicode dec": "50", "Unicode hex": "32" },
    { "Typeface name": "Symbol", "Dingbat dec": "51", "Dingbat hex": "33", "Unicode dec": "51", "Unicode hex": "33" },
    { "Typeface name": "Symbol", "Dingbat dec": "52", "Dingbat hex": "34", "Unicode dec": "52", "Unicode hex": "34" },
    { "Typeface name": "Symbol", "Dingbat dec": "53", "Dingbat hex": "35", "Unicode dec": "53", "Unicode hex": "35" },
    { "Typeface name": "Symbol", "Dingbat dec": "54", "Dingbat hex": "36", "Unicode dec": "54", "Unicode hex": "36" },
    { "Typeface name": "Symbol", "Dingbat dec": "55", "Dingbat hex": "37", "Unicode dec": "55", "Unicode hex": "37" },
    { "Typeface name": "Symbol", "Dingbat dec": "56", "Dingbat hex": "38", "Unicode dec": "56", "Unicode hex": "38" },
    { "Typeface name": "Symbol", "Dingbat dec": "57", "Dingbat hex": "39", "Unicode dec": "57", "Unicode hex": "39" },
    { "Typeface name": "Symbol", "Dingbat dec": "58", "Dingbat hex": "3A", "Unicode dec": "58", "Unicode hex": "3A" },
    { "Typeface name": "Symbol", "Dingbat dec": "59", "Dingbat hex": "3B", "Unicode dec": "59", "Unicode hex": "3B" },
    { "Typeface name": "Symbol", "Dingbat dec": "60", "Dingbat hex": "3C", "Unicode dec": "60", "Unicode hex": "3C" },
    { "Typeface name": "Symbol", "Dingbat dec": "61", "Dingbat hex": "3D", "Unicode dec": "61", "Unicode hex": "3D" },
    { "Typeface name": "Symbol", "Dingbat dec": "62", "Dingbat hex": "3E", "Unicode dec": "62", "Unicode hex": "3E" },
    { "Typeface name": "Symbol", "Dingbat dec": "63", "Dingbat hex": "3F", "Unicode dec": "63", "Unicode hex": "3F" },
    { "Typeface name": "Symbol", "Dingbat dec": "64", "Dingbat hex": "40", "Unicode dec": "8773", "Unicode hex": "2245" },
    { "Typeface name": "Symbol", "Dingbat dec": "65", "Dingbat hex": "41", "Unicode dec": "913", "Unicode hex": "391" },
    { "Typeface name": "Symbol", "Dingbat dec": "66", "Dingbat hex": "42", "Unicode dec": "914", "Unicode hex": "392" },
    { "Typeface name": "Symbol", "Dingbat dec": "67", "Dingbat hex": "43", "Unicode dec": "935", "Unicode hex": "3A7" },
    { "Typeface name": "Symbol", "Dingbat dec": "68", "Dingbat hex": "44", "Unicode dec": "916", "Unicode hex": "394" },
    { "Typeface name": "Symbol", "Dingbat dec": "69", "Dingbat hex": "45", "Unicode dec": "917", "Unicode hex": "395" },
    { "Typeface name": "Symbol", "Dingbat dec": "70", "Dingbat hex": "46", "Unicode dec": "934", "Unicode hex": "3A6" },
    { "Typeface name": "Symbol", "Dingbat dec": "71", "Dingbat hex": "47", "Unicode dec": "915", "Unicode hex": "393" },
    { "Typeface name": "Symbol", "Dingbat dec": "72", "Dingbat hex": "48", "Unicode dec": "919", "Unicode hex": "397" },
    { "Typeface name": "Symbol", "Dingbat dec": "73", "Dingbat hex": "49", "Unicode dec": "921", "Unicode hex": "399" },
    { "Typeface name": "Symbol", "Dingbat dec": "74", "Dingbat hex": "4A", "Unicode dec": "977", "Unicode hex": "3D1" },
    { "Typeface name": "Symbol", "Dingbat dec": "75", "Dingbat hex": "4B", "Unicode dec": "922", "Unicode hex": "39A" },
    { "Typeface name": "Symbol", "Dingbat dec": "76", "Dingbat hex": "4C", "Unicode dec": "923", "Unicode hex": "39B" },
    { "Typeface name": "Symbol", "Dingbat dec": "77", "Dingbat hex": "4D", "Unicode dec": "924", "Unicode hex": "39C" },
    { "Typeface name": "Symbol", "Dingbat dec": "78", "Dingbat hex": "4E", "Unicode dec": "925", "Unicode hex": "39D" },
    { "Typeface name": "Symbol", "Dingbat dec": "79", "Dingbat hex": "4F", "Unicode dec": "927", "Unicode hex": "39F" },
    { "Typeface name": "Symbol", "Dingbat dec": "80", "Dingbat hex": "50", "Unicode dec": "928", "Unicode hex": "3A0" },
    { "Typeface name": "Symbol", "Dingbat dec": "81", "Dingbat hex": "51", "Unicode dec": "920", "Unicode hex": "398" },
    { "Typeface name": "Symbol", "Dingbat dec": "82", "Dingbat hex": "52", "Unicode dec": "929", "Unicode hex": "3A1" },
    { "Typeface name": "Symbol", "Dingbat dec": "83", "Dingbat hex": "53", "Unicode dec": "931", "Unicode hex": "3A3" },
    { "Typeface name": "Symbol", "Dingbat dec": "84", "Dingbat hex": "54", "Unicode dec": "932", "Unicode hex": "3A4" },
    { "Typeface name": "Symbol", "Dingbat dec": "85", "Dingbat hex": "55", "Unicode dec": "933", "Unicode hex": "3A5" },
    { "Typeface name": "Symbol", "Dingbat dec": "86", "Dingbat hex": "56", "Unicode dec": "962", "Unicode hex": "3C2" },
    { "Typeface name": "Symbol", "Dingbat dec": "87", "Dingbat hex": "57", "Unicode dec": "937", "Unicode hex": "3A9" },
    { "Typeface name": "Symbol", "Dingbat dec": "88", "Dingbat hex": "58", "Unicode dec": "926", "Unicode hex": "39E" },
    { "Typeface name": "Symbol", "Dingbat dec": "89", "Dingbat hex": "59", "Unicode dec": "936", "Unicode hex": "3A8" },
    { "Typeface name": "Symbol", "Dingbat dec": "90", "Dingbat hex": "5A", "Unicode dec": "918", "Unicode hex": "396" },
    { "Typeface name": "Symbol", "Dingbat dec": "91", "Dingbat hex": "5B", "Unicode dec": "91", "Unicode hex": "5B" },
    { "Typeface name": "Symbol", "Dingbat dec": "92", "Dingbat hex": "5C", "Unicode dec": "8756", "Unicode hex": "2234" },
    { "Typeface name": "Symbol", "Dingbat dec": "93", "Dingbat hex": "5D", "Unicode dec": "93", "Unicode hex": "5D" },
    { "Typeface name": "Symbol", "Dingbat dec": "94", "Dingbat hex": "5E", "Unicode dec": "8869", "Unicode hex": "22A5" },
    { "Typeface name": "Symbol", "Dingbat dec": "95", "Dingbat hex": "5F", "Unicode dec": "95", "Unicode hex": "5F" },
    { "Typeface name": "Symbol", "Dingbat dec": "96", "Dingbat hex": "60", "Unicode dec": "8254", "Unicode hex": "203E" },
    { "Typeface name": "Symbol", "Dingbat dec": "97", "Dingbat hex": "61", "Unicode dec": "945", "Unicode hex": "3B1" },
    { "Typeface name": "Symbol", "Dingbat dec": "98", "Dingbat hex": "62", "Unicode dec": "946", "Unicode hex": "3B2" },
    { "Typeface name": "Symbol", "Dingbat dec": "99", "Dingbat hex": "63", "Unicode dec": "967", "Unicode hex": "3C7" },
    { "Typeface name": "Symbol", "Dingbat dec": "100", "Dingbat hex": "64", "Unicode dec": "948", "Unicode hex": "3B4" },
    { "Typeface name": "Symbol", "Dingbat dec": "101", "Dingbat hex": "65", "Unicode dec": "949", "Unicode hex": "3B5" },
    { "Typeface name": "Symbol", "Dingbat dec": "102", "Dingbat hex": "66", "Unicode dec": "966", "Unicode hex": "3C6" },
    { "Typeface name": "Symbol", "Dingbat dec": "103", "Dingbat hex": "67", "Unicode dec": "947", "Unicode hex": "3B3" },
    { "Typeface name": "Symbol", "Dingbat dec": "104", "Dingbat hex": "68", "Unicode dec": "951", "Unicode hex": "3B7" },
    { "Typeface name": "Symbol", "Dingbat dec": "105", "Dingbat hex": "69", "Unicode dec": "953", "Unicode hex": "3B9" },
    { "Typeface name": "Symbol", "Dingbat dec": "106", "Dingbat hex": "6A", "Unicode dec": "981", "Unicode hex": "3D5" },
    { "Typeface name": "Symbol", "Dingbat dec": "107", "Dingbat hex": "6B", "Unicode dec": "954", "Unicode hex": "3BA" },
    { "Typeface name": "Symbol", "Dingbat dec": "108", "Dingbat hex": "6C", "Unicode dec": "955", "Unicode hex": "3BB" },
    { "Typeface name": "Symbol", "Dingbat dec": "109", "Dingbat hex": "6D", "Unicode dec": "956", "Unicode hex": "3BC" },
    { "Typeface name": "Symbol", "Dingbat dec": "110", "Dingbat hex": "6E", "Unicode dec": "957", "Unicode hex": "3BD" },
    { "Typeface name": "Symbol", "Dingbat dec": "111", "Dingbat hex": "6F", "Unicode dec": "959", "Unicode hex": "3BF" },
    { "Typeface name": "Symbol", "Dingbat dec": "112", "Dingbat hex": "70", "Unicode dec": "960", "Unicode hex": "3C0" },
    { "Typeface name": "Symbol", "Dingbat dec": "113", "Dingbat hex": "71", "Unicode dec": "952", "Unicode hex": "3B8" },
    { "Typeface name": "Symbol", "Dingbat dec": "114", "Dingbat hex": "72", "Unicode dec": "961", "Unicode hex": "3C1" },
    { "Typeface name": "Symbol", "Dingbat dec": "115", "Dingbat hex": "73", "Unicode dec": "963", "Unicode hex": "3C3" },
    { "Typeface name": "Symbol", "Dingbat dec": "116", "Dingbat hex": "74", "Unicode dec": "964", "Unicode hex": "3C4" },
    { "Typeface name": "Symbol", "Dingbat dec": "117", "Dingbat hex": "75", "Unicode dec": "965", "Unicode hex": "3C5" },
    { "Typeface name": "Symbol", "Dingbat dec": "118", "Dingbat hex": "76", "Unicode dec": "982", "Unicode hex": "3D6" },
    { "Typeface name": "Symbol", "Dingbat dec": "119", "Dingbat hex": "77", "Unicode dec": "969", "Unicode hex": "3C9" },
    { "Typeface name": "Symbol", "Dingbat dec": "120", "Dingbat hex": "78", "Unicode dec": "958", "Unicode hex": "3BE" },
    { "Typeface name": "Symbol", "Dingbat dec": "121", "Dingbat hex": "79", "Unicode dec": "968", "Unicode hex": "3C8" },
    { "Typeface name": "Symbol", "Dingbat dec": "122", "Dingbat hex": "7A", "Unicode dec": "950", "Unicode hex": "3B6" },
    { "Typeface name": "Symbol", "Dingbat dec": "123", "Dingbat hex": "7B", "Unicode dec": "123", "Unicode hex": "7B" },
    { "Typeface name": "Symbol", "Dingbat dec": "124", "Dingbat hex": "7C", "Unicode dec": "124", "Unicode hex": "7C" },
    { "Typeface name": "Symbol", "Dingbat dec": "125", "Dingbat hex": "7D", "Unicode dec": "125", "Unicode hex": "7D" },
    { "Typeface name": "Symbol", "Dingbat dec": "126", "Dingbat hex": "7E", "Unicode dec": "126", "Unicode hex": "7E" },
    { "Typeface name": "Symbol", "Dingbat dec": "160", "Dingbat hex": "A0", "Unicode dec": "8364", "Unicode hex": "20AC" },
    { "Typeface name": "Symbol", "Dingbat dec": "161", "Dingbat hex": "A1", "Unicode dec": "978", "Unicode hex": "3D2" },
    { "Typeface name": "Symbol", "Dingbat dec": "162", "Dingbat hex": "A2", "Unicode dec": "8242", "Unicode hex": "2032" },
    { "Typeface name": "Symbol", "Dingbat dec": "163", "Dingbat hex": "A3", "Unicode dec": "8804", "Unicode hex": "2264" },
    { "Typeface name": "Symbol", "Dingbat dec": "164", "Dingbat hex": "A4", "Unicode dec": "8260", "Unicode hex": "2044" },
    { "Typeface name": "Symbol", "Dingbat dec": "165", "Dingbat hex": "A5", "Unicode dec": "8734", "Unicode hex": "221E" },
    { "Typeface name": "Symbol", "Dingbat dec": "166", "Dingbat hex": "A6", "Unicode dec": "402", "Unicode hex": "192" },
    { "Typeface name": "Symbol", "Dingbat dec": "167", "Dingbat hex": "A7", "Unicode dec": "9827", "Unicode hex": "2663" },
    { "Typeface name": "Symbol", "Dingbat dec": "168", "Dingbat hex": "A8", "Unicode dec": "9830", "Unicode hex": "2666" },
    { "Typeface name": "Symbol", "Dingbat dec": "169", "Dingbat hex": "A9", "Unicode dec": "9829", "Unicode hex": "2665" },
    { "Typeface name": "Symbol", "Dingbat dec": "170", "Dingbat hex": "AA", "Unicode dec": "9824", "Unicode hex": "2660" },
    { "Typeface name": "Symbol", "Dingbat dec": "171", "Dingbat hex": "AB", "Unicode dec": "8596", "Unicode hex": "2194" },
    { "Typeface name": "Symbol", "Dingbat dec": "172", "Dingbat hex": "AC", "Unicode dec": "8592", "Unicode hex": "2190" },
    { "Typeface name": "Symbol", "Dingbat dec": "173", "Dingbat hex": "AD", "Unicode dec": "8593", "Unicode hex": "2191" },
    { "Typeface name": "Symbol", "Dingbat dec": "174", "Dingbat hex": "AE", "Unicode dec": "8594", "Unicode hex": "2192" },
    { "Typeface name": "Symbol", "Dingbat dec": "175", "Dingbat hex": "AF", "Unicode dec": "8595", "Unicode hex": "2193" },
    { "Typeface name": "Symbol", "Dingbat dec": "176", "Dingbat hex": "B0", "Unicode dec": "176", "Unicode hex": "B0" },
    { "Typeface name": "Symbol", "Dingbat dec": "177", "Dingbat hex": "B1", "Unicode dec": "177", "Unicode hex": "B1" },
    { "Typeface name": "Symbol", "Dingbat dec": "178", "Dingbat hex": "B2", "Unicode dec": "8243", "Unicode hex": "2033" },
    { "Typeface name": "Symbol", "Dingbat dec": "179", "Dingbat hex": "B3", "Unicode dec": "8805", "Unicode hex": "2265" },
    { "Typeface name": "Symbol", "Dingbat dec": "180", "Dingbat hex": "B4", "Unicode dec": "215", "Unicode hex": "D7" },
    { "Typeface name": "Symbol", "Dingbat dec": "181", "Dingbat hex": "B5", "Unicode dec": "8733", "Unicode hex": "221D" },
    { "Typeface name": "Symbol", "Dingbat dec": "182", "Dingbat hex": "B6", "Unicode dec": "8706", "Unicode hex": "2202" },
    { "Typeface name": "Symbol", "Dingbat dec": "183", "Dingbat hex": "B7", "Unicode dec": "8226", "Unicode hex": "2022" },
    { "Typeface name": "Symbol", "Dingbat dec": "184", "Dingbat hex": "B8", "Unicode dec": "247", "Unicode hex": "F7" },
    { "Typeface name": "Symbol", "Dingbat dec": "185", "Dingbat hex": "B9", "Unicode dec": "8800", "Unicode hex": "2260" },
    { "Typeface name": "Symbol", "Dingbat dec": "186", "Dingbat hex": "BA", "Unicode dec": "8801", "Unicode hex": "2261" },
    { "Typeface name": "Symbol", "Dingbat dec": "187", "Dingbat hex": "BB", "Unicode dec": "8776", "Unicode hex": "2248" },
    { "Typeface name": "Symbol", "Dingbat dec": "188", "Dingbat hex": "BC", "Unicode dec": "8230", "Unicode hex": "2026" },
    { "Typeface name": "Symbol", "Dingbat dec": "189", "Dingbat hex": "BD", "Unicode dec": "9168", "Unicode hex": "23D0" },
    { "Typeface name": "Symbol", "Dingbat dec": "190", "Dingbat hex": "BE", "Unicode dec": "9135", "Unicode hex": "23AF" },
    { "Typeface name": "Symbol", "Dingbat dec": "191", "Dingbat hex": "BF", "Unicode dec": "8629", "Unicode hex": "21B5" },
    { "Typeface name": "Symbol", "Dingbat dec": "192", "Dingbat hex": "C0", "Unicode dec": "8501", "Unicode hex": "2135" },
    { "Typeface name": "Symbol", "Dingbat dec": "193", "Dingbat hex": "C1", "Unicode dec": "8465", "Unicode hex": "2111" },
    { "Typeface name": "Symbol", "Dingbat dec": "194", "Dingbat hex": "C2", "Unicode dec": "8476", "Unicode hex": "211C" },
    { "Typeface name": "Symbol", "Dingbat dec": "195", "Dingbat hex": "C3", "Unicode dec": "8472", "Unicode hex": "2118" },
    { "Typeface name": "Symbol", "Dingbat dec": "196", "Dingbat hex": "C4", "Unicode dec": "8855", "Unicode hex": "2297" },
    { "Typeface name": "Symbol", "Dingbat dec": "197", "Dingbat hex": "C5", "Unicode dec": "8853", "Unicode hex": "2295" },
    { "Typeface name": "Symbol", "Dingbat dec": "198", "Dingbat hex": "C6", "Unicode dec": "8709", "Unicode hex": "2205" },
    { "Typeface name": "Symbol", "Dingbat dec": "199", "Dingbat hex": "C7", "Unicode dec": "8745", "Unicode hex": "2229" },
    { "Typeface name": "Symbol", "Dingbat dec": "200", "Dingbat hex": "C8", "Unicode dec": "8746", "Unicode hex": "222A" },
    { "Typeface name": "Symbol", "Dingbat dec": "201", "Dingbat hex": "C9", "Unicode dec": "8835", "Unicode hex": "2283" },
    { "Typeface name": "Symbol", "Dingbat dec": "202", "Dingbat hex": "CA", "Unicode dec": "8839", "Unicode hex": "2287" },
    { "Typeface name": "Symbol", "Dingbat dec": "203", "Dingbat hex": "CB", "Unicode dec": "8836", "Unicode hex": "2284" },
    { "Typeface name": "Symbol", "Dingbat dec": "204", "Dingbat hex": "CC", "Unicode dec": "8834", "Unicode hex": "2282" },
    { "Typeface name": "Symbol", "Dingbat dec": "205", "Dingbat hex": "CD", "Unicode dec": "8838", "Unicode hex": "2286" },
    { "Typeface name": "Symbol", "Dingbat dec": "206", "Dingbat hex": "CE", "Unicode dec": "8712", "Unicode hex": "2208" },
    { "Typeface name": "Symbol", "Dingbat dec": "207", "Dingbat hex": "CF", "Unicode dec": "8713", "Unicode hex": "2209" },
    { "Typeface name": "Symbol", "Dingbat dec": "208", "Dingbat hex": "D0", "Unicode dec": "8736", "Unicode hex": "2220" },
    { "Typeface name": "Symbol", "Dingbat dec": "209", "Dingbat hex": "D1", "Unicode dec": "8711", "Unicode hex": "2207" },
    { "Typeface name": "Symbol", "Dingbat dec": "210", "Dingbat hex": "D2", "Unicode dec": "174", "Unicode hex": "AE" },
    { "Typeface name": "Symbol", "Dingbat dec": "211", "Dingbat hex": "D3", "Unicode dec": "169", "Unicode hex": "A9" },
    { "Typeface name": "Symbol", "Dingbat dec": "212", "Dingbat hex": "D4", "Unicode dec": "8482", "Unicode hex": "2122" },
    { "Typeface name": "Symbol", "Dingbat dec": "213", "Dingbat hex": "D5", "Unicode dec": "8719", "Unicode hex": "220F" },
    { "Typeface name": "Symbol", "Dingbat dec": "214", "Dingbat hex": "D6", "Unicode dec": "8730", "Unicode hex": "221A" },
    { "Typeface name": "Symbol", "Dingbat dec": "215", "Dingbat hex": "D7", "Unicode dec": "8901", "Unicode hex": "22C5" },
    { "Typeface name": "Symbol", "Dingbat dec": "216", "Dingbat hex": "D8", "Unicode dec": "172", "Unicode hex": "AC" },
    { "Typeface name": "Symbol", "Dingbat dec": "217", "Dingbat hex": "D9", "Unicode dec": "8743", "Unicode hex": "2227" },
    { "Typeface name": "Symbol", "Dingbat dec": "218", "Dingbat hex": "DA", "Unicode dec": "8744", "Unicode hex": "2228" },
    { "Typeface name": "Symbol", "Dingbat dec": "219", "Dingbat hex": "DB", "Unicode dec": "8660", "Unicode hex": "21D4" },
    { "Typeface name": "Symbol", "Dingbat dec": "220", "Dingbat hex": "DC", "Unicode dec": "8656", "Unicode hex": "21D0" },
    { "Typeface name": "Symbol", "Dingbat dec": "221", "Dingbat hex": "DD", "Unicode dec": "8657", "Unicode hex": "21D1" },
    { "Typeface name": "Symbol", "Dingbat dec": "222", "Dingbat hex": "DE", "Unicode dec": "8658", "Unicode hex": "21D2" },
    { "Typeface name": "Symbol", "Dingbat dec": "223", "Dingbat hex": "DF", "Unicode dec": "8659", "Unicode hex": "21D3" },
    { "Typeface name": "Symbol", "Dingbat dec": "224", "Dingbat hex": "E0", "Unicode dec": "9674", "Unicode hex": "25CA" },
    { "Typeface name": "Symbol", "Dingbat dec": "225", "Dingbat hex": "E1", "Unicode dec": "12296", "Unicode hex": "3008" },
    { "Typeface name": "Symbol", "Dingbat dec": "226", "Dingbat hex": "E2", "Unicode dec": "174", "Unicode hex": "AE" },
    { "Typeface name": "Symbol", "Dingbat dec": "227", "Dingbat hex": "E3", "Unicode dec": "169", "Unicode hex": "A9" },
    { "Typeface name": "Symbol", "Dingbat dec": "228", "Dingbat hex": "E4", "Unicode dec": "8482", "Unicode hex": "2122" },
    { "Typeface name": "Symbol", "Dingbat dec": "229", "Dingbat hex": "E5", "Unicode dec": "8721", "Unicode hex": "2211" },
    { "Typeface name": "Symbol", "Dingbat dec": "230", "Dingbat hex": "E6", "Unicode dec": "9115", "Unicode hex": "239B" },
    { "Typeface name": "Symbol", "Dingbat dec": "231", "Dingbat hex": "E7", "Unicode dec": "9116", "Unicode hex": "239C" },
    { "Typeface name": "Symbol", "Dingbat dec": "232", "Dingbat hex": "E8", "Unicode dec": "9117", "Unicode hex": "239D" },
    { "Typeface name": "Symbol", "Dingbat dec": "233", "Dingbat hex": "E9", "Unicode dec": "9121", "Unicode hex": "23A1" },
    { "Typeface name": "Symbol", "Dingbat dec": "234", "Dingbat hex": "EA", "Unicode dec": "9122", "Unicode hex": "23A2" },
    { "Typeface name": "Symbol", "Dingbat dec": "235", "Dingbat hex": "EB", "Unicode dec": "9123", "Unicode hex": "23A3" },
    { "Typeface name": "Symbol", "Dingbat dec": "236", "Dingbat hex": "EC", "Unicode dec": "9127", "Unicode hex": "23A7" },
    { "Typeface name": "Symbol", "Dingbat dec": "237", "Dingbat hex": "ED", "Unicode dec": "9128", "Unicode hex": "23A8" },
    { "Typeface name": "Symbol", "Dingbat dec": "238", "Dingbat hex": "EE", "Unicode dec": "9129", "Unicode hex": "23A9" },
    { "Typeface name": "Symbol", "Dingbat dec": "239", "Dingbat hex": "EF", "Unicode dec": "9130", "Unicode hex": "23AA" },
    { "Typeface name": "Symbol", "Dingbat dec": "240", "Dingbat hex": "F0", "Unicode dec": "63743", "Unicode hex": "F8FF" },
    { "Typeface name": "Symbol", "Dingbat dec": "241", "Dingbat hex": "F1", "Unicode dec": "12297", "Unicode hex": "3009" },
    { "Typeface name": "Symbol", "Dingbat dec": "242", "Dingbat hex": "F2", "Unicode dec": "8747", "Unicode hex": "222B" },
    { "Typeface name": "Symbol", "Dingbat dec": "243", "Dingbat hex": "F3", "Unicode dec": "8992", "Unicode hex": "2320" },
    { "Typeface name": "Symbol", "Dingbat dec": "244", "Dingbat hex": "F4", "Unicode dec": "9134", "Unicode hex": "23AE" },
    { "Typeface name": "Symbol", "Dingbat dec": "245", "Dingbat hex": "F5", "Unicode dec": "8993", "Unicode hex": "2321" },
    { "Typeface name": "Symbol", "Dingbat dec": "246", "Dingbat hex": "F6", "Unicode dec": "9118", "Unicode hex": "239E" },
    { "Typeface name": "Symbol", "Dingbat dec": "247", "Dingbat hex": "F7", "Unicode dec": "9119", "Unicode hex": "239F" },
    { "Typeface name": "Symbol", "Dingbat dec": "248", "Dingbat hex": "F8", "Unicode dec": "9120", "Unicode hex": "23A0" },
    { "Typeface name": "Symbol", "Dingbat dec": "249", "Dingbat hex": "F9", "Unicode dec": "9124", "Unicode hex": "23A4" },
    { "Typeface name": "Symbol", "Dingbat dec": "250", "Dingbat hex": "FA", "Unicode dec": "9125", "Unicode hex": "23A5" },
    { "Typeface name": "Symbol", "Dingbat dec": "251", "Dingbat hex": "FB", "Unicode dec": "9126", "Unicode hex": "23A6" },
    { "Typeface name": "Symbol", "Dingbat dec": "252", "Dingbat hex": "FC", "Unicode dec": "9131", "Unicode hex": "23AB" },
    { "Typeface name": "Symbol", "Dingbat dec": "253", "Dingbat hex": "FD", "Unicode dec": "9132", "Unicode hex": "23AC" },
    { "Typeface name": "Symbol", "Dingbat dec": "254", "Dingbat hex": "FE", "Unicode dec": "9133", "Unicode hex": "23AD" },
    { "Typeface name": "Webdings", "Dingbat dec": "32", "Dingbat hex": "20", "Unicode dec": "32", "Unicode hex": "20" },
    { "Typeface name": "Webdings", "Dingbat dec": "33", "Dingbat hex": "21", "Unicode dec": "128375", "Unicode hex": "1F577" },
    { "Typeface name": "Webdings", "Dingbat dec": "34", "Dingbat hex": "22", "Unicode dec": "128376", "Unicode hex": "1F578" },
    { "Typeface name": "Webdings", "Dingbat dec": "35", "Dingbat hex": "23", "Unicode dec": "128370", "Unicode hex": "1F572" },
    { "Typeface name": "Webdings", "Dingbat dec": "36", "Dingbat hex": "24", "Unicode dec": "128374", "Unicode hex": "1F576" },
    { "Typeface name": "Webdings", "Dingbat dec": "37", "Dingbat hex": "25", "Unicode dec": "127942", "Unicode hex": "1F3C6" },
    { "Typeface name": "Webdings", "Dingbat dec": "38", "Dingbat hex": "26", "Unicode dec": "127894", "Unicode hex": "1F396" },
    { "Typeface name": "Webdings", "Dingbat dec": "39", "Dingbat hex": "27", "Unicode dec": "128391", "Unicode hex": "1F587" },
    { "Typeface name": "Webdings", "Dingbat dec": "40", "Dingbat hex": "28", "Unicode dec": "128488", "Unicode hex": "1F5E8" },
    { "Typeface name": "Webdings", "Dingbat dec": "41", "Dingbat hex": "29", "Unicode dec": "128489", "Unicode hex": "1F5E9" },
    { "Typeface name": "Webdings", "Dingbat dec": "42", "Dingbat hex": "2A", "Unicode dec": "128496", "Unicode hex": "1F5F0" },
    { "Typeface name": "Webdings", "Dingbat dec": "43", "Dingbat hex": "2B", "Unicode dec": "128497", "Unicode hex": "1F5F1" },
    { "Typeface name": "Webdings", "Dingbat dec": "44", "Dingbat hex": "2C", "Unicode dec": "127798", "Unicode hex": "1F336" },
    { "Typeface name": "Webdings", "Dingbat dec": "45", "Dingbat hex": "2D", "Unicode dec": "127895", "Unicode hex": "1F397" },
    { "Typeface name": "Webdings", "Dingbat dec": "46", "Dingbat hex": "2E", "Unicode dec": "128638", "Unicode hex": "1F67E" },
    { "Typeface name": "Webdings", "Dingbat dec": "47", "Dingbat hex": "2F", "Unicode dec": "128636", "Unicode hex": "1F67C" },
    { "Typeface name": "Webdings", "Dingbat dec": "48", "Dingbat hex": "30", "Unicode dec": "128469", "Unicode hex": "1F5D5" },
    { "Typeface name": "Webdings", "Dingbat dec": "49", "Dingbat hex": "31", "Unicode dec": "128470", "Unicode hex": "1F5D6" },
    { "Typeface name": "Webdings", "Dingbat dec": "50", "Dingbat hex": "32", "Unicode dec": "128471", "Unicode hex": "1F5D7" },
    { "Typeface name": "Webdings", "Dingbat dec": "51", "Dingbat hex": "33", "Unicode dec": "9204", "Unicode hex": "23F4" },
    { "Typeface name": "Webdings", "Dingbat dec": "52", "Dingbat hex": "34", "Unicode dec": "9205", "Unicode hex": "23F5" },
    { "Typeface name": "Webdings", "Dingbat dec": "53", "Dingbat hex": "35", "Unicode dec": "9206", "Unicode hex": "23F6" },
    { "Typeface name": "Webdings", "Dingbat dec": "54", "Dingbat hex": "36", "Unicode dec": "9207", "Unicode hex": "23F7" },
    { "Typeface name": "Webdings", "Dingbat dec": "55", "Dingbat hex": "37", "Unicode dec": "9194", "Unicode hex": "23EA" },
    { "Typeface name": "Webdings", "Dingbat dec": "56", "Dingbat hex": "38", "Unicode dec": "9193", "Unicode hex": "23E9" },
    { "Typeface name": "Webdings", "Dingbat dec": "57", "Dingbat hex": "39", "Unicode dec": "9198", "Unicode hex": "23EE" },
    { "Typeface name": "Webdings", "Dingbat dec": "58", "Dingbat hex": "3A", "Unicode dec": "9197", "Unicode hex": "23ED" },
    { "Typeface name": "Webdings", "Dingbat dec": "59", "Dingbat hex": "3B", "Unicode dec": "9208", "Unicode hex": "23F8" },
    { "Typeface name": "Webdings", "Dingbat dec": "60", "Dingbat hex": "3C", "Unicode dec": "9209", "Unicode hex": "23F9" },
    { "Typeface name": "Webdings", "Dingbat dec": "61", "Dingbat hex": "3D", "Unicode dec": "9210", "Unicode hex": "23FA" },
    { "Typeface name": "Webdings", "Dingbat dec": "62", "Dingbat hex": "3E", "Unicode dec": "128474", "Unicode hex": "1F5DA" },
    { "Typeface name": "Webdings", "Dingbat dec": "63", "Dingbat hex": "3F", "Unicode dec": "128499", "Unicode hex": "1F5F3" },
    { "Typeface name": "Webdings", "Dingbat dec": "64", "Dingbat hex": "40", "Unicode dec": "128736", "Unicode hex": "1F6E0" },
    { "Typeface name": "Webdings", "Dingbat dec": "65", "Dingbat hex": "41", "Unicode dec": "127959", "Unicode hex": "1F3D7" },
    { "Typeface name": "Webdings", "Dingbat dec": "66", "Dingbat hex": "42", "Unicode dec": "127960", "Unicode hex": "1F3D8" },
    { "Typeface name": "Webdings", "Dingbat dec": "67", "Dingbat hex": "43", "Unicode dec": "127961", "Unicode hex": "1F3D9" },
    { "Typeface name": "Webdings", "Dingbat dec": "68", "Dingbat hex": "44", "Unicode dec": "127962", "Unicode hex": "1F3DA" },
    { "Typeface name": "Webdings", "Dingbat dec": "69", "Dingbat hex": "45", "Unicode dec": "127964", "Unicode hex": "1F3DC" },
    { "Typeface name": "Webdings", "Dingbat dec": "70", "Dingbat hex": "46", "Unicode dec": "127981", "Unicode hex": "1F3ED" },
    { "Typeface name": "Webdings", "Dingbat dec": "71", "Dingbat hex": "47", "Unicode dec": "127963", "Unicode hex": "1F3DB" },
    { "Typeface name": "Webdings", "Dingbat dec": "72", "Dingbat hex": "48", "Unicode dec": "127968", "Unicode hex": "1F3E0" },
    { "Typeface name": "Webdings", "Dingbat dec": "73", "Dingbat hex": "49", "Unicode dec": "127958", "Unicode hex": "1F3D6" },
    { "Typeface name": "Webdings", "Dingbat dec": "74", "Dingbat hex": "4A", "Unicode dec": "127965", "Unicode hex": "1F3DD" },
    { "Typeface name": "Webdings", "Dingbat dec": "75", "Dingbat hex": "4B", "Unicode dec": "128739", "Unicode hex": "1F6E3" },
    { "Typeface name": "Webdings", "Dingbat dec": "76", "Dingbat hex": "4C", "Unicode dec": "128269", "Unicode hex": "1F50D" },
    { "Typeface name": "Webdings", "Dingbat dec": "77", "Dingbat hex": "4D", "Unicode dec": "127956", "Unicode hex": "1F3D4" },
    { "Typeface name": "Webdings", "Dingbat dec": "78", "Dingbat hex": "4E", "Unicode dec": "128065", "Unicode hex": "1F441" },
    { "Typeface name": "Webdings", "Dingbat dec": "79", "Dingbat hex": "4F", "Unicode dec": "128066", "Unicode hex": "1F442" },
    { "Typeface name": "Webdings", "Dingbat dec": "80", "Dingbat hex": "50", "Unicode dec": "127966", "Unicode hex": "1F3DE" },
    { "Typeface name": "Webdings", "Dingbat dec": "81", "Dingbat hex": "51", "Unicode dec": "127957", "Unicode hex": "1F3D5" },
    { "Typeface name": "Webdings", "Dingbat dec": "82", "Dingbat hex": "52", "Unicode dec": "128740", "Unicode hex": "1F6E4" },
    { "Typeface name": "Webdings", "Dingbat dec": "83", "Dingbat hex": "53", "Unicode dec": "127967", "Unicode hex": "1F3DF" },
    { "Typeface name": "Webdings", "Dingbat dec": "84", "Dingbat hex": "54", "Unicode dec": "128755", "Unicode hex": "1F6F3" },
    { "Typeface name": "Webdings", "Dingbat dec": "85", "Dingbat hex": "55", "Unicode dec": "128364", "Unicode hex": "1F56C" },
    { "Typeface name": "Webdings", "Dingbat dec": "86", "Dingbat hex": "56", "Unicode dec": "128363", "Unicode hex": "1F56B" },
    { "Typeface name": "Webdings", "Dingbat dec": "87", "Dingbat hex": "57", "Unicode dec": "128360", "Unicode hex": "1F568" },
    { "Typeface name": "Webdings", "Dingbat dec": "88", "Dingbat hex": "58", "Unicode dec": "128264", "Unicode hex": "1F508" },
    { "Typeface name": "Webdings", "Dingbat dec": "89", "Dingbat hex": "59", "Unicode dec": "127892", "Unicode hex": "1F394" },
    { "Typeface name": "Webdings", "Dingbat dec": "90", "Dingbat hex": "5A", "Unicode dec": "127893", "Unicode hex": "1F395" },
    { "Typeface name": "Webdings", "Dingbat dec": "91", "Dingbat hex": "5B", "Unicode dec": "128492", "Unicode hex": "1F5EC" },
    { "Typeface name": "Webdings", "Dingbat dec": "92", "Dingbat hex": "5C", "Unicode dec": "128637", "Unicode hex": "1F67D" },
    { "Typeface name": "Webdings", "Dingbat dec": "93", "Dingbat hex": "5D", "Unicode dec": "128493", "Unicode hex": "1F5ED" },
    { "Typeface name": "Webdings", "Dingbat dec": "94", "Dingbat hex": "5E", "Unicode dec": "128490", "Unicode hex": "1F5EA" },
    { "Typeface name": "Webdings", "Dingbat dec": "95", "Dingbat hex": "5F", "Unicode dec": "128491", "Unicode hex": "1F5EB" },
    { "Typeface name": "Webdings", "Dingbat dec": "96", "Dingbat hex": "60", "Unicode dec": "11156", "Unicode hex": "2B94" },
    { "Typeface name": "Webdings", "Dingbat dec": "97", "Dingbat hex": "61", "Unicode dec": "10004", "Unicode hex": "2714" },
    { "Typeface name": "Webdings", "Dingbat dec": "98", "Dingbat hex": "62", "Unicode dec": "128690", "Unicode hex": "1F6B2" },
    { "Typeface name": "Webdings", "Dingbat dec": "99", "Dingbat hex": "63", "Unicode dec": "11036", "Unicode hex": "2B1C" },
    { "Typeface name": "Webdings", "Dingbat dec": "100", "Dingbat hex": "64", "Unicode dec": "128737", "Unicode hex": "1F6E1" },
    { "Typeface name": "Webdings", "Dingbat dec": "101", "Dingbat hex": "65", "Unicode dec": "128230", "Unicode hex": "1F4E6" },
    { "Typeface name": "Webdings", "Dingbat dec": "102", "Dingbat hex": "66", "Unicode dec": "128753", "Unicode hex": "1F6F1" },
    { "Typeface name": "Webdings", "Dingbat dec": "103", "Dingbat hex": "67", "Unicode dec": "11035", "Unicode hex": "2B1B" },
    { "Typeface name": "Webdings", "Dingbat dec": "104", "Dingbat hex": "68", "Unicode dec": "128657", "Unicode hex": "1F691" },
    { "Typeface name": "Webdings", "Dingbat dec": "105", "Dingbat hex": "69", "Unicode dec": "128712", "Unicode hex": "1F6C8" },
    { "Typeface name": "Webdings", "Dingbat dec": "106", "Dingbat hex": "6A", "Unicode dec": "128745", "Unicode hex": "1F6E9" },
    { "Typeface name": "Webdings", "Dingbat dec": "107", "Dingbat hex": "6B", "Unicode dec": "128752", "Unicode hex": "1F6F0" },
    { "Typeface name": "Webdings", "Dingbat dec": "108", "Dingbat hex": "6C", "Unicode dec": "128968", "Unicode hex": "1F7C8" },
    { "Typeface name": "Webdings", "Dingbat dec": "109", "Dingbat hex": "6D", "Unicode dec": "128372", "Unicode hex": "1F574" },
    { "Typeface name": "Webdings", "Dingbat dec": "110", "Dingbat hex": "6E", "Unicode dec": "11044", "Unicode hex": "2B24" },
    { "Typeface name": "Webdings", "Dingbat dec": "111", "Dingbat hex": "6F", "Unicode dec": "128741", "Unicode hex": "1F6E5" },
    { "Typeface name": "Webdings", "Dingbat dec": "112", "Dingbat hex": "70", "Unicode dec": "128660", "Unicode hex": "1F694" },
    { "Typeface name": "Webdings", "Dingbat dec": "113", "Dingbat hex": "71", "Unicode dec": "128472", "Unicode hex": "1F5D8" },
    { "Typeface name": "Webdings", "Dingbat dec": "114", "Dingbat hex": "72", "Unicode dec": "128473", "Unicode hex": "1F5D9" },
    { "Typeface name": "Webdings", "Dingbat dec": "115", "Dingbat hex": "73", "Unicode dec": "10067", "Unicode hex": "2753" },
    { "Typeface name": "Webdings", "Dingbat dec": "116", "Dingbat hex": "74", "Unicode dec": "128754", "Unicode hex": "1F6F2" },
    { "Typeface name": "Webdings", "Dingbat dec": "117", "Dingbat hex": "75", "Unicode dec": "128647", "Unicode hex": "1F687" },
    { "Typeface name": "Webdings", "Dingbat dec": "118", "Dingbat hex": "76", "Unicode dec": "128653", "Unicode hex": "1F68D" },
    { "Typeface name": "Webdings", "Dingbat dec": "119", "Dingbat hex": "77", "Unicode dec": "9971", "Unicode hex": "26F3" },
    { "Typeface name": "Webdings", "Dingbat dec": "120", "Dingbat hex": "78", "Unicode dec": "10680", "Unicode hex": "29B8" },
    { "Typeface name": "Webdings", "Dingbat dec": "121", "Dingbat hex": "79", "Unicode dec": "8854", "Unicode hex": "2296" },
    { "Typeface name": "Webdings", "Dingbat dec": "122", "Dingbat hex": "7A", "Unicode dec": "128685", "Unicode hex": "1F6AD" },
    { "Typeface name": "Webdings", "Dingbat dec": "123", "Dingbat hex": "7B", "Unicode dec": "128494", "Unicode hex": "1F5EE" },
    { "Typeface name": "Webdings", "Dingbat dec": "124", "Dingbat hex": "7C", "Unicode dec": "9168", "Unicode hex": "23D0" },
    { "Typeface name": "Webdings", "Dingbat dec": "125", "Dingbat hex": "7D", "Unicode dec": "128495", "Unicode hex": "1F5EF" },
    { "Typeface name": "Webdings", "Dingbat dec": "126", "Dingbat hex": "7E", "Unicode dec": "128498", "Unicode hex": "1F5F2" },
    { "Typeface name": "Webdings", "Dingbat dec": "128", "Dingbat hex": "80", "Unicode dec": "128697", "Unicode hex": "1F6B9" },
    { "Typeface name": "Webdings", "Dingbat dec": "129", "Dingbat hex": "81", "Unicode dec": "128698", "Unicode hex": "1F6BA" },
    { "Typeface name": "Webdings", "Dingbat dec": "130", "Dingbat hex": "82", "Unicode dec": "128713", "Unicode hex": "1F6C9" },
    { "Typeface name": "Webdings", "Dingbat dec": "131", "Dingbat hex": "83", "Unicode dec": "128714", "Unicode hex": "1F6CA" },
    { "Typeface name": "Webdings", "Dingbat dec": "132", "Dingbat hex": "84", "Unicode dec": "128700", "Unicode hex": "1F6BC" },
    { "Typeface name": "Webdings", "Dingbat dec": "133", "Dingbat hex": "85", "Unicode dec": "128125", "Unicode hex": "1F47D" },
    { "Typeface name": "Webdings", "Dingbat dec": "134", "Dingbat hex": "86", "Unicode dec": "127947", "Unicode hex": "1F3CB" },
    { "Typeface name": "Webdings", "Dingbat dec": "135", "Dingbat hex": "87", "Unicode dec": "9975", "Unicode hex": "26F7" },
    { "Typeface name": "Webdings", "Dingbat dec": "136", "Dingbat hex": "88", "Unicode dec": "127938", "Unicode hex": "1F3C2" },
    { "Typeface name": "Webdings", "Dingbat dec": "137", "Dingbat hex": "89", "Unicode dec": "127948", "Unicode hex": "1F3CC" },
    { "Typeface name": "Webdings", "Dingbat dec": "138", "Dingbat hex": "8A", "Unicode dec": "127946", "Unicode hex": "1F3CA" },
    { "Typeface name": "Webdings", "Dingbat dec": "139", "Dingbat hex": "8B", "Unicode dec": "127940", "Unicode hex": "1F3C4" },
    { "Typeface name": "Webdings", "Dingbat dec": "140", "Dingbat hex": "8C", "Unicode dec": "127949", "Unicode hex": "1F3CD" },
    { "Typeface name": "Webdings", "Dingbat dec": "141", "Dingbat hex": "8D", "Unicode dec": "127950", "Unicode hex": "1F3CE" },
    { "Typeface name": "Webdings", "Dingbat dec": "142", "Dingbat hex": "8E", "Unicode dec": "128664", "Unicode hex": "1F698" },
    { "Typeface name": "Webdings", "Dingbat dec": "143", "Dingbat hex": "8F", "Unicode dec": "128480", "Unicode hex": "1F5E0" },
    { "Typeface name": "Webdings", "Dingbat dec": "144", "Dingbat hex": "90", "Unicode dec": "128738", "Unicode hex": "1F6E2" },
    { "Typeface name": "Webdings", "Dingbat dec": "145", "Dingbat hex": "91", "Unicode dec": "128176", "Unicode hex": "1F4B0" },
    { "Typeface name": "Webdings", "Dingbat dec": "146", "Dingbat hex": "92", "Unicode dec": "127991", "Unicode hex": "1F3F7" },
    { "Typeface name": "Webdings", "Dingbat dec": "147", "Dingbat hex": "93", "Unicode dec": "128179", "Unicode hex": "1F4B3" },
    { "Typeface name": "Webdings", "Dingbat dec": "148", "Dingbat hex": "94", "Unicode dec": "128106", "Unicode hex": "1F46A" },
    { "Typeface name": "Webdings", "Dingbat dec": "149", "Dingbat hex": "95", "Unicode dec": "128481", "Unicode hex": "1F5E1" },
    { "Typeface name": "Webdings", "Dingbat dec": "150", "Dingbat hex": "96", "Unicode dec": "128482", "Unicode hex": "1F5E2" },
    { "Typeface name": "Webdings", "Dingbat dec": "151", "Dingbat hex": "97", "Unicode dec": "128483", "Unicode hex": "1F5E3" },
    { "Typeface name": "Webdings", "Dingbat dec": "152", "Dingbat hex": "98", "Unicode dec": "10031", "Unicode hex": "272F" },
    { "Typeface name": "Webdings", "Dingbat dec": "153", "Dingbat hex": "99", "Unicode dec": "128388", "Unicode hex": "1F584" },
    { "Typeface name": "Webdings", "Dingbat dec": "154", "Dingbat hex": "9A", "Unicode dec": "128389", "Unicode hex": "1F585" },
    { "Typeface name": "Webdings", "Dingbat dec": "155", "Dingbat hex": "9B", "Unicode dec": "128387", "Unicode hex": "1F583" },
    { "Typeface name": "Webdings", "Dingbat dec": "156", "Dingbat hex": "9C", "Unicode dec": "128390", "Unicode hex": "1F586" },
    { "Typeface name": "Webdings", "Dingbat dec": "157", "Dingbat hex": "9D", "Unicode dec": "128441", "Unicode hex": "1F5B9" },
    { "Typeface name": "Webdings", "Dingbat dec": "158", "Dingbat hex": "9E", "Unicode dec": "128442", "Unicode hex": "1F5BA" },
    { "Typeface name": "Webdings", "Dingbat dec": "159", "Dingbat hex": "9F", "Unicode dec": "128443", "Unicode hex": "1F5BB" },
    { "Typeface name": "Webdings", "Dingbat dec": "160", "Dingbat hex": "A0", "Unicode dec": "128373", "Unicode hex": "1F575" },
    { "Typeface name": "Webdings", "Dingbat dec": "161", "Dingbat hex": "A1", "Unicode dec": "128368", "Unicode hex": "1F570" },
    { "Typeface name": "Webdings", "Dingbat dec": "162", "Dingbat hex": "A2", "Unicode dec": "128445", "Unicode hex": "1F5BD" },
    { "Typeface name": "Webdings", "Dingbat dec": "163", "Dingbat hex": "A3", "Unicode dec": "128446", "Unicode hex": "1F5BE" },
    { "Typeface name": "Webdings", "Dingbat dec": "164", "Dingbat hex": "A4", "Unicode dec": "128203", "Unicode hex": "1F4CB" },
    { "Typeface name": "Webdings", "Dingbat dec": "165", "Dingbat hex": "A5", "Unicode dec": "128466", "Unicode hex": "1F5D2" },
    { "Typeface name": "Webdings", "Dingbat dec": "166", "Dingbat hex": "A6", "Unicode dec": "128467", "Unicode hex": "1F5D3" },
    { "Typeface name": "Webdings", "Dingbat dec": "167", "Dingbat hex": "A7", "Unicode dec": "128366", "Unicode hex": "1F56E" },
    { "Typeface name": "Webdings", "Dingbat dec": "168", "Dingbat hex": "A8", "Unicode dec": "128218", "Unicode hex": "1F4DA" },
    { "Typeface name": "Webdings", "Dingbat dec": "169", "Dingbat hex": "A9", "Unicode dec": "128478", "Unicode hex": "1F5DE" },
    { "Typeface name": "Webdings", "Dingbat dec": "170", "Dingbat hex": "AA", "Unicode dec": "128479", "Unicode hex": "1F5DF" },
    { "Typeface name": "Webdings", "Dingbat dec": "171", "Dingbat hex": "AB", "Unicode dec": "128451", "Unicode hex": "1F5C3" },
    { "Typeface name": "Webdings", "Dingbat dec": "172", "Dingbat hex": "AC", "Unicode dec": "128450", "Unicode hex": "1F5C2" },
    { "Typeface name": "Webdings", "Dingbat dec": "173", "Dingbat hex": "AD", "Unicode dec": "128444", "Unicode hex": "1F5BC" },
    { "Typeface name": "Webdings", "Dingbat dec": "174", "Dingbat hex": "AE", "Unicode dec": "127917", "Unicode hex": "1F3AD" },
    { "Typeface name": "Webdings", "Dingbat dec": "175", "Dingbat hex": "AF", "Unicode dec": "127900", "Unicode hex": "1F39C" },
    { "Typeface name": "Webdings", "Dingbat dec": "176", "Dingbat hex": "B0", "Unicode dec": "127896", "Unicode hex": "1F398" },
    { "Typeface name": "Webdings", "Dingbat dec": "177", "Dingbat hex": "B1", "Unicode dec": "127897", "Unicode hex": "1F399" },
    { "Typeface name": "Webdings", "Dingbat dec": "178", "Dingbat hex": "B2", "Unicode dec": "127911", "Unicode hex": "1F3A7" },
    { "Typeface name": "Webdings", "Dingbat dec": "179", "Dingbat hex": "B3", "Unicode dec": "128191", "Unicode hex": "1F4BF" },
    { "Typeface name": "Webdings", "Dingbat dec": "180", "Dingbat hex": "B4", "Unicode dec": "127902", "Unicode hex": "1F39E" },
    { "Typeface name": "Webdings", "Dingbat dec": "181", "Dingbat hex": "B5", "Unicode dec": "128247", "Unicode hex": "1F4F7" },
    { "Typeface name": "Webdings", "Dingbat dec": "182", "Dingbat hex": "B6", "Unicode dec": "127903", "Unicode hex": "1F39F" },
    { "Typeface name": "Webdings", "Dingbat dec": "183", "Dingbat hex": "B7", "Unicode dec": "127916", "Unicode hex": "1F3AC" },
    { "Typeface name": "Webdings", "Dingbat dec": "184", "Dingbat hex": "B8", "Unicode dec": "128253", "Unicode hex": "1F4FD" },
    { "Typeface name": "Webdings", "Dingbat dec": "185", "Dingbat hex": "B9", "Unicode dec": "128249", "Unicode hex": "1F4F9" },
    { "Typeface name": "Webdings", "Dingbat dec": "186", "Dingbat hex": "BA", "Unicode dec": "128254", "Unicode hex": "1F4FE" },
    { "Typeface name": "Webdings", "Dingbat dec": "187", "Dingbat hex": "BB", "Unicode dec": "128251", "Unicode hex": "1F4FB" },
    { "Typeface name": "Webdings", "Dingbat dec": "188", "Dingbat hex": "BC", "Unicode dec": "127898", "Unicode hex": "1F39A" },
    { "Typeface name": "Webdings", "Dingbat dec": "189", "Dingbat hex": "BD", "Unicode dec": "127899", "Unicode hex": "1F39B" },
    { "Typeface name": "Webdings", "Dingbat dec": "190", "Dingbat hex": "BE", "Unicode dec": "128250", "Unicode hex": "1F4FA" },
    { "Typeface name": "Webdings", "Dingbat dec": "191", "Dingbat hex": "BF", "Unicode dec": "128187", "Unicode hex": "1F4BB" },
    { "Typeface name": "Webdings", "Dingbat dec": "192", "Dingbat hex": "C0", "Unicode dec": "128421", "Unicode hex": "1F5A5" },
    { "Typeface name": "Webdings", "Dingbat dec": "193", "Dingbat hex": "C1", "Unicode dec": "128422", "Unicode hex": "1F5A6" },
    { "Typeface name": "Webdings", "Dingbat dec": "194", "Dingbat hex": "C2", "Unicode dec": "128423", "Unicode hex": "1F5A7" },
    { "Typeface name": "Webdings", "Dingbat dec": "195", "Dingbat hex": "C3", "Unicode dec": "128377", "Unicode hex": "1F579" },
    { "Typeface name": "Webdings", "Dingbat dec": "196", "Dingbat hex": "C4", "Unicode dec": "127918", "Unicode hex": "1F3AE" },
    { "Typeface name": "Webdings", "Dingbat dec": "197", "Dingbat hex": "C5", "Unicode dec": "128379", "Unicode hex": "1F57B" },
    { "Typeface name": "Webdings", "Dingbat dec": "198", "Dingbat hex": "C6", "Unicode dec": "128380", "Unicode hex": "1F57C" },
    { "Typeface name": "Webdings", "Dingbat dec": "199", "Dingbat hex": "C7", "Unicode dec": "128223", "Unicode hex": "1F4DF" },
    { "Typeface name": "Webdings", "Dingbat dec": "200", "Dingbat hex": "C8", "Unicode dec": "128385", "Unicode hex": "1F581" },
    { "Typeface name": "Webdings", "Dingbat dec": "201", "Dingbat hex": "C9", "Unicode dec": "128384", "Unicode hex": "1F580" },
    { "Typeface name": "Webdings", "Dingbat dec": "202", "Dingbat hex": "CA", "Unicode dec": "128424", "Unicode hex": "1F5A8" },
    { "Typeface name": "Webdings", "Dingbat dec": "203", "Dingbat hex": "CB", "Unicode dec": "128425", "Unicode hex": "1F5A9" },
    { "Typeface name": "Webdings", "Dingbat dec": "204", "Dingbat hex": "CC", "Unicode dec": "128447", "Unicode hex": "1F5BF" },
    { "Typeface name": "Webdings", "Dingbat dec": "205", "Dingbat hex": "CD", "Unicode dec": "128426", "Unicode hex": "1F5AA" },
    { "Typeface name": "Webdings", "Dingbat dec": "206", "Dingbat hex": "CE", "Unicode dec": "128476", "Unicode hex": "1F5DC" },
    { "Typeface name": "Webdings", "Dingbat dec": "207", "Dingbat hex": "CF", "Unicode dec": "128274", "Unicode hex": "1F512" },
    { "Typeface name": "Webdings", "Dingbat dec": "208", "Dingbat hex": "D0", "Unicode dec": "128275", "Unicode hex": "1F513" },
    { "Typeface name": "Webdings", "Dingbat dec": "209", "Dingbat hex": "D1", "Unicode dec": "128477", "Unicode hex": "1F5DD" },
    { "Typeface name": "Webdings", "Dingbat dec": "210", "Dingbat hex": "D2", "Unicode dec": "128229", "Unicode hex": "1F4E5" },
    { "Typeface name": "Webdings", "Dingbat dec": "211", "Dingbat hex": "D3", "Unicode dec": "128228", "Unicode hex": "1F4E4" },
    { "Typeface name": "Webdings", "Dingbat dec": "212", "Dingbat hex": "D4", "Unicode dec": "128371", "Unicode hex": "1F573" },
    { "Typeface name": "Webdings", "Dingbat dec": "213", "Dingbat hex": "D5", "Unicode dec": "127779", "Unicode hex": "1F323" },
    { "Typeface name": "Webdings", "Dingbat dec": "214", "Dingbat hex": "D6", "Unicode dec": "127780", "Unicode hex": "1F324" },
    { "Typeface name": "Webdings", "Dingbat dec": "215", "Dingbat hex": "D7", "Unicode dec": "127781", "Unicode hex": "1F325" },
    { "Typeface name": "Webdings", "Dingbat dec": "216", "Dingbat hex": "D8", "Unicode dec": "127782", "Unicode hex": "1F326" },
    { "Typeface name": "Webdings", "Dingbat dec": "217", "Dingbat hex": "D9", "Unicode dec": "9729", "Unicode hex": "2601" },
    { "Typeface name": "Webdings", "Dingbat dec": "218", "Dingbat hex": "DA", "Unicode dec": "127784", "Unicode hex": "1F328" },
    { "Typeface name": "Webdings", "Dingbat dec": "219", "Dingbat hex": "DB", "Unicode dec": "127783", "Unicode hex": "1F327" },
    { "Typeface name": "Webdings", "Dingbat dec": "220", "Dingbat hex": "DC", "Unicode dec": "127785", "Unicode hex": "1F329" },
    { "Typeface name": "Webdings", "Dingbat dec": "221", "Dingbat hex": "DD", "Unicode dec": "127786", "Unicode hex": "1F32A" },
    { "Typeface name": "Webdings", "Dingbat dec": "222", "Dingbat hex": "DE", "Unicode dec": "127788", "Unicode hex": "1F32C" },
    { "Typeface name": "Webdings", "Dingbat dec": "223", "Dingbat hex": "DF", "Unicode dec": "127787", "Unicode hex": "1F32B" },
    { "Typeface name": "Webdings", "Dingbat dec": "224", "Dingbat hex": "E0", "Unicode dec": "127772", "Unicode hex": "1F31C" },
    { "Typeface name": "Webdings", "Dingbat dec": "225", "Dingbat hex": "E1", "Unicode dec": "127777", "Unicode hex": "1F321" },
    { "Typeface name": "Webdings", "Dingbat dec": "226", "Dingbat hex": "E2", "Unicode dec": "128715", "Unicode hex": "1F6CB" },
    { "Typeface name": "Webdings", "Dingbat dec": "227", "Dingbat hex": "E3", "Unicode dec": "128719", "Unicode hex": "1F6CF" },
    { "Typeface name": "Webdings", "Dingbat dec": "228", "Dingbat hex": "E4", "Unicode dec": "127869", "Unicode hex": "1F37D" },
    { "Typeface name": "Webdings", "Dingbat dec": "229", "Dingbat hex": "E5", "Unicode dec": "127864", "Unicode hex": "1F378" },
    { "Typeface name": "Webdings", "Dingbat dec": "230", "Dingbat hex": "E6", "Unicode dec": "128718", "Unicode hex": "1F6CE" },
    { "Typeface name": "Webdings", "Dingbat dec": "231", "Dingbat hex": "E7", "Unicode dec": "128717", "Unicode hex": "1F6CD" },
    { "Typeface name": "Webdings", "Dingbat dec": "232", "Dingbat hex": "E8", "Unicode dec": "9413", "Unicode hex": "24C5" },
    { "Typeface name": "Webdings", "Dingbat dec": "233", "Dingbat hex": "E9", "Unicode dec": "9855", "Unicode hex": "267F" },
    { "Typeface name": "Webdings", "Dingbat dec": "234", "Dingbat hex": "EA", "Unicode dec": "128710", "Unicode hex": "1F6C6" },
    { "Typeface name": "Webdings", "Dingbat dec": "235", "Dingbat hex": "EB", "Unicode dec": "128392", "Unicode hex": "1F588" },
    { "Typeface name": "Webdings", "Dingbat dec": "236", "Dingbat hex": "EC", "Unicode dec": "127891", "Unicode hex": "1F393" },
    { "Typeface name": "Webdings", "Dingbat dec": "237", "Dingbat hex": "ED", "Unicode dec": "128484", "Unicode hex": "1F5E4" },
    { "Typeface name": "Webdings", "Dingbat dec": "238", "Dingbat hex": "EE", "Unicode dec": "128485", "Unicode hex": "1F5E5" },
    { "Typeface name": "Webdings", "Dingbat dec": "239", "Dingbat hex": "EF", "Unicode dec": "128486", "Unicode hex": "1F5E6" },
    { "Typeface name": "Webdings", "Dingbat dec": "240", "Dingbat hex": "F0", "Unicode dec": "128487", "Unicode hex": "1F5E7" },
    { "Typeface name": "Webdings", "Dingbat dec": "241", "Dingbat hex": "F1", "Unicode dec": "128746", "Unicode hex": "1F6EA" },
    { "Typeface name": "Webdings", "Dingbat dec": "242", "Dingbat hex": "F2", "Unicode dec": "128063", "Unicode hex": "1F43F" },
    { "Typeface name": "Webdings", "Dingbat dec": "243", "Dingbat hex": "F3", "Unicode dec": "128038", "Unicode hex": "1F426" },
    { "Typeface name": "Webdings", "Dingbat dec": "244", "Dingbat hex": "F4", "Unicode dec": "128031", "Unicode hex": "1F41F" },
    { "Typeface name": "Webdings", "Dingbat dec": "245", "Dingbat hex": "F5", "Unicode dec": "128021", "Unicode hex": "1F415" },
    { "Typeface name": "Webdings", "Dingbat dec": "246", "Dingbat hex": "F6", "Unicode dec": "128008", "Unicode hex": "1F408" },
    { "Typeface name": "Webdings", "Dingbat dec": "247", "Dingbat hex": "F7", "Unicode dec": "128620", "Unicode hex": "1F66C" },
    { "Typeface name": "Webdings", "Dingbat dec": "248", "Dingbat hex": "F8", "Unicode dec": "128622", "Unicode hex": "1F66E" },
    { "Typeface name": "Webdings", "Dingbat dec": "249", "Dingbat hex": "F9", "Unicode dec": "128621", "Unicode hex": "1F66D" },
    { "Typeface name": "Webdings", "Dingbat dec": "250", "Dingbat hex": "FA", "Unicode dec": "128623", "Unicode hex": "1F66F" },
    { "Typeface name": "Webdings", "Dingbat dec": "251", "Dingbat hex": "FB", "Unicode dec": "128506", "Unicode hex": "1F5FA" },
    { "Typeface name": "Webdings", "Dingbat dec": "252", "Dingbat hex": "FC", "Unicode dec": "127757", "Unicode hex": "1F30D" },
    { "Typeface name": "Webdings", "Dingbat dec": "253", "Dingbat hex": "FD", "Unicode dec": "127759", "Unicode hex": "1F30F" },
    { "Typeface name": "Webdings", "Dingbat dec": "254", "Dingbat hex": "FE", "Unicode dec": "127758", "Unicode hex": "1F30E" },
    { "Typeface name": "Webdings", "Dingbat dec": "255", "Dingbat hex": "FF", "Unicode dec": "128330", "Unicode hex": "1F54A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "32", "Dingbat hex": "20", "Unicode dec": "32", "Unicode hex": "20" },
    { "Typeface name": "Wingdings", "Dingbat dec": "33", "Dingbat hex": "21", "Unicode dec": "128393", "Unicode hex": "1F589" },
    { "Typeface name": "Wingdings", "Dingbat dec": "34", "Dingbat hex": "22", "Unicode dec": "9986", "Unicode hex": "2702" },
    { "Typeface name": "Wingdings", "Dingbat dec": "35", "Dingbat hex": "23", "Unicode dec": "9985", "Unicode hex": "2701" },
    { "Typeface name": "Wingdings", "Dingbat dec": "36", "Dingbat hex": "24", "Unicode dec": "128083", "Unicode hex": "1F453" },
    { "Typeface name": "Wingdings", "Dingbat dec": "37", "Dingbat hex": "25", "Unicode dec": "128365", "Unicode hex": "1F56D" },
    { "Typeface name": "Wingdings", "Dingbat dec": "38", "Dingbat hex": "26", "Unicode dec": "128366", "Unicode hex": "1F56E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "39", "Dingbat hex": "27", "Unicode dec": "128367", "Unicode hex": "1F56F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "40", "Dingbat hex": "28", "Unicode dec": "128383", "Unicode hex": "1F57F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "41", "Dingbat hex": "29", "Unicode dec": "9990", "Unicode hex": "2706" },
    { "Typeface name": "Wingdings", "Dingbat dec": "42", "Dingbat hex": "2A", "Unicode dec": "128386", "Unicode hex": "1F582" },
    { "Typeface name": "Wingdings", "Dingbat dec": "43", "Dingbat hex": "2B", "Unicode dec": "128387", "Unicode hex": "1F583" },
    { "Typeface name": "Wingdings", "Dingbat dec": "44", "Dingbat hex": "2C", "Unicode dec": "128234", "Unicode hex": "1F4EA" },
    { "Typeface name": "Wingdings", "Dingbat dec": "45", "Dingbat hex": "2D", "Unicode dec": "128235", "Unicode hex": "1F4EB" },
    { "Typeface name": "Wingdings", "Dingbat dec": "46", "Dingbat hex": "2E", "Unicode dec": "128236", "Unicode hex": "1F4EC" },
    { "Typeface name": "Wingdings", "Dingbat dec": "47", "Dingbat hex": "2F", "Unicode dec": "128237", "Unicode hex": "1F4ED" },
    { "Typeface name": "Wingdings", "Dingbat dec": "48", "Dingbat hex": "30", "Unicode dec": "128448", "Unicode hex": "1F5C0" },
    { "Typeface name": "Wingdings", "Dingbat dec": "49", "Dingbat hex": "31", "Unicode dec": "128449", "Unicode hex": "1F5C1" },
    { "Typeface name": "Wingdings", "Dingbat dec": "50", "Dingbat hex": "32", "Unicode dec": "128462", "Unicode hex": "1F5CE" },
    { "Typeface name": "Wingdings", "Dingbat dec": "51", "Dingbat hex": "33", "Unicode dec": "128463", "Unicode hex": "1F5CF" },
    { "Typeface name": "Wingdings", "Dingbat dec": "52", "Dingbat hex": "34", "Unicode dec": "128464", "Unicode hex": "1F5D0" },
    { "Typeface name": "Wingdings", "Dingbat dec": "53", "Dingbat hex": "35", "Unicode dec": "128452", "Unicode hex": "1F5C4" },
    { "Typeface name": "Wingdings", "Dingbat dec": "54", "Dingbat hex": "36", "Unicode dec": "8987", "Unicode hex": "231B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "55", "Dingbat hex": "37", "Unicode dec": "128430", "Unicode hex": "1F5AE" },
    { "Typeface name": "Wingdings", "Dingbat dec": "56", "Dingbat hex": "38", "Unicode dec": "128432", "Unicode hex": "1F5B0" },
    { "Typeface name": "Wingdings", "Dingbat dec": "57", "Dingbat hex": "39", "Unicode dec": "128434", "Unicode hex": "1F5B2" },
    { "Typeface name": "Wingdings", "Dingbat dec": "58", "Dingbat hex": "3A", "Unicode dec": "128435", "Unicode hex": "1F5B3" },
    { "Typeface name": "Wingdings", "Dingbat dec": "59", "Dingbat hex": "3B", "Unicode dec": "128436", "Unicode hex": "1F5B4" },
    { "Typeface name": "Wingdings", "Dingbat dec": "60", "Dingbat hex": "3C", "Unicode dec": "128427", "Unicode hex": "1F5AB" },
    { "Typeface name": "Wingdings", "Dingbat dec": "61", "Dingbat hex": "3D", "Unicode dec": "128428", "Unicode hex": "1F5AC" },
    { "Typeface name": "Wingdings", "Dingbat dec": "62", "Dingbat hex": "3E", "Unicode dec": "9991", "Unicode hex": "2707" },
    { "Typeface name": "Wingdings", "Dingbat dec": "63", "Dingbat hex": "3F", "Unicode dec": "9997", "Unicode hex": "270D" },
    { "Typeface name": "Wingdings", "Dingbat dec": "64", "Dingbat hex": "40", "Unicode dec": "128398", "Unicode hex": "1F58E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "65", "Dingbat hex": "41", "Unicode dec": "9996", "Unicode hex": "270C" },
    { "Typeface name": "Wingdings", "Dingbat dec": "66", "Dingbat hex": "42", "Unicode dec": "128399", "Unicode hex": "1F58F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "67", "Dingbat hex": "43", "Unicode dec": "128077", "Unicode hex": "1F44D" },
    { "Typeface name": "Wingdings", "Dingbat dec": "68", "Dingbat hex": "44", "Unicode dec": "128078", "Unicode hex": "1F44E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "69", "Dingbat hex": "45", "Unicode dec": "9756", "Unicode hex": "261C" },
    { "Typeface name": "Wingdings", "Dingbat dec": "70", "Dingbat hex": "46", "Unicode dec": "9758", "Unicode hex": "261E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "71", "Dingbat hex": "47", "Unicode dec": "9757", "Unicode hex": "261D" },
    { "Typeface name": "Wingdings", "Dingbat dec": "72", "Dingbat hex": "48", "Unicode dec": "9759", "Unicode hex": "261F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "73", "Dingbat hex": "49", "Unicode dec": "128400", "Unicode hex": "1F590" },
    { "Typeface name": "Wingdings", "Dingbat dec": "74", "Dingbat hex": "4A", "Unicode dec": "9786", "Unicode hex": "263A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "75", "Dingbat hex": "4B", "Unicode dec": "128528", "Unicode hex": "1F610" },
    { "Typeface name": "Wingdings", "Dingbat dec": "76", "Dingbat hex": "4C", "Unicode dec": "9785", "Unicode hex": "2639" },
    { "Typeface name": "Wingdings", "Dingbat dec": "77", "Dingbat hex": "4D", "Unicode dec": "128163", "Unicode hex": "1F4A3" },
    { "Typeface name": "Wingdings", "Dingbat dec": "78", "Dingbat hex": "4E", "Unicode dec": "128369", "Unicode hex": "1F571" },
    { "Typeface name": "Wingdings", "Dingbat dec": "79", "Dingbat hex": "4F", "Unicode dec": "127987", "Unicode hex": "1F3F3" },
    { "Typeface name": "Wingdings", "Dingbat dec": "80", "Dingbat hex": "50", "Unicode dec": "127985", "Unicode hex": "1F3F1" },
    { "Typeface name": "Wingdings", "Dingbat dec": "81", "Dingbat hex": "51", "Unicode dec": "9992", "Unicode hex": "2708" },
    { "Typeface name": "Wingdings", "Dingbat dec": "82", "Dingbat hex": "52", "Unicode dec": "9788", "Unicode hex": "263C" },
    { "Typeface name": "Wingdings", "Dingbat dec": "83", "Dingbat hex": "53", "Unicode dec": "127778", "Unicode hex": "1F322" },
    { "Typeface name": "Wingdings", "Dingbat dec": "84", "Dingbat hex": "54", "Unicode dec": "10052", "Unicode hex": "2744" },
    { "Typeface name": "Wingdings", "Dingbat dec": "85", "Dingbat hex": "55", "Unicode dec": "128326", "Unicode hex": "1F546" },
    { "Typeface name": "Wingdings", "Dingbat dec": "86", "Dingbat hex": "56", "Unicode dec": "10014", "Unicode hex": "271E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "87", "Dingbat hex": "57", "Unicode dec": "128328", "Unicode hex": "1F548" },
    { "Typeface name": "Wingdings", "Dingbat dec": "88", "Dingbat hex": "58", "Unicode dec": "10016", "Unicode hex": "2720" },
    { "Typeface name": "Wingdings", "Dingbat dec": "89", "Dingbat hex": "59", "Unicode dec": "10017", "Unicode hex": "2721" },
    { "Typeface name": "Wingdings", "Dingbat dec": "90", "Dingbat hex": "5A", "Unicode dec": "9770", "Unicode hex": "262A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "91", "Dingbat hex": "5B", "Unicode dec": "9775", "Unicode hex": "262F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "92", "Dingbat hex": "5C", "Unicode dec": "128329", "Unicode hex": "1F549" },
    { "Typeface name": "Wingdings", "Dingbat dec": "93", "Dingbat hex": "5D", "Unicode dec": "9784", "Unicode hex": "2638" },
    { "Typeface name": "Wingdings", "Dingbat dec": "94", "Dingbat hex": "5E", "Unicode dec": "9800", "Unicode hex": "2648" },
    { "Typeface name": "Wingdings", "Dingbat dec": "95", "Dingbat hex": "5F", "Unicode dec": "9801", "Unicode hex": "2649" },
    { "Typeface name": "Wingdings", "Dingbat dec": "96", "Dingbat hex": "60", "Unicode dec": "9802", "Unicode hex": "264A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "97", "Dingbat hex": "61", "Unicode dec": "9803", "Unicode hex": "264B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "98", "Dingbat hex": "62", "Unicode dec": "9804", "Unicode hex": "264C" },
    { "Typeface name": "Wingdings", "Dingbat dec": "99", "Dingbat hex": "63", "Unicode dec": "9805", "Unicode hex": "264D" },
    { "Typeface name": "Wingdings", "Dingbat dec": "100", "Dingbat hex": "64", "Unicode dec": "9806", "Unicode hex": "264E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "101", "Dingbat hex": "65", "Unicode dec": "9807", "Unicode hex": "264F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "102", "Dingbat hex": "66", "Unicode dec": "9808", "Unicode hex": "2650" },
    { "Typeface name": "Wingdings", "Dingbat dec": "103", "Dingbat hex": "67", "Unicode dec": "9809", "Unicode hex": "2651" },
    { "Typeface name": "Wingdings", "Dingbat dec": "104", "Dingbat hex": "68", "Unicode dec": "9810", "Unicode hex": "2652" },
    { "Typeface name": "Wingdings", "Dingbat dec": "105", "Dingbat hex": "69", "Unicode dec": "9811", "Unicode hex": "2653" },
    { "Typeface name": "Wingdings", "Dingbat dec": "106", "Dingbat hex": "6A", "Unicode dec": "128624", "Unicode hex": "1F670" },
    { "Typeface name": "Wingdings", "Dingbat dec": "107", "Dingbat hex": "6B", "Unicode dec": "128629", "Unicode hex": "1F675" },
    { "Typeface name": "Wingdings", "Dingbat dec": "108", "Dingbat hex": "6C", "Unicode dec": "9899", "Unicode hex": "26AB" },
    { "Typeface name": "Wingdings", "Dingbat dec": "109", "Dingbat hex": "6D", "Unicode dec": "128318", "Unicode hex": "1F53E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "110", "Dingbat hex": "6E", "Unicode dec": "9724", "Unicode hex": "25FC" },
    { "Typeface name": "Wingdings", "Dingbat dec": "111", "Dingbat hex": "6F", "Unicode dec": "128911", "Unicode hex": "1F78F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "112", "Dingbat hex": "70", "Unicode dec": "128912", "Unicode hex": "1F790" },
    { "Typeface name": "Wingdings", "Dingbat dec": "113", "Dingbat hex": "71", "Unicode dec": "10065", "Unicode hex": "2751" },
    { "Typeface name": "Wingdings", "Dingbat dec": "114", "Dingbat hex": "72", "Unicode dec": "10066", "Unicode hex": "2752" },
    { "Typeface name": "Wingdings", "Dingbat dec": "115", "Dingbat hex": "73", "Unicode dec": "128927", "Unicode hex": "1F79F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "116", "Dingbat hex": "74", "Unicode dec": "10731", "Unicode hex": "29EB" },
    { "Typeface name": "Wingdings", "Dingbat dec": "117", "Dingbat hex": "75", "Unicode dec": "9670", "Unicode hex": "25C6" },
    { "Typeface name": "Wingdings", "Dingbat dec": "118", "Dingbat hex": "76", "Unicode dec": "10070", "Unicode hex": "2756" },
    { "Typeface name": "Wingdings", "Dingbat dec": "119", "Dingbat hex": "77", "Unicode dec": "11049", "Unicode hex": "2B29" },
    { "Typeface name": "Wingdings", "Dingbat dec": "120", "Dingbat hex": "78", "Unicode dec": "8999", "Unicode hex": "2327" },
    { "Typeface name": "Wingdings", "Dingbat dec": "121", "Dingbat hex": "79", "Unicode dec": "11193", "Unicode hex": "2BB9" },
    { "Typeface name": "Wingdings", "Dingbat dec": "122", "Dingbat hex": "7A", "Unicode dec": "8984", "Unicode hex": "2318" },
    { "Typeface name": "Wingdings", "Dingbat dec": "123", "Dingbat hex": "7B", "Unicode dec": "127989", "Unicode hex": "1F3F5" },
    { "Typeface name": "Wingdings", "Dingbat dec": "124", "Dingbat hex": "7C", "Unicode dec": "127990", "Unicode hex": "1F3F6" },
    { "Typeface name": "Wingdings", "Dingbat dec": "125", "Dingbat hex": "7D", "Unicode dec": "128630", "Unicode hex": "1F676" },
    { "Typeface name": "Wingdings", "Dingbat dec": "126", "Dingbat hex": "7E", "Unicode dec": "128631", "Unicode hex": "1F677" },
    { "Typeface name": "Wingdings", "Dingbat dec": "127", "Dingbat hex": "7F", "Unicode dec": "9647", "Unicode hex": "25AF" },
    { "Typeface name": "Wingdings", "Dingbat dec": "128", "Dingbat hex": "80", "Unicode dec": "127243", "Unicode hex": "1F10B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "129", "Dingbat hex": "81", "Unicode dec": "10112", "Unicode hex": "2780" },
    { "Typeface name": "Wingdings", "Dingbat dec": "130", "Dingbat hex": "82", "Unicode dec": "10113", "Unicode hex": "2781" },
    { "Typeface name": "Wingdings", "Dingbat dec": "131", "Dingbat hex": "83", "Unicode dec": "10114", "Unicode hex": "2782" },
    { "Typeface name": "Wingdings", "Dingbat dec": "132", "Dingbat hex": "84", "Unicode dec": "10115", "Unicode hex": "2783" },
    { "Typeface name": "Wingdings", "Dingbat dec": "133", "Dingbat hex": "85", "Unicode dec": "10116", "Unicode hex": "2784" },
    { "Typeface name": "Wingdings", "Dingbat dec": "134", "Dingbat hex": "86", "Unicode dec": "10117", "Unicode hex": "2785" },
    { "Typeface name": "Wingdings", "Dingbat dec": "135", "Dingbat hex": "87", "Unicode dec": "10118", "Unicode hex": "2786" },
    { "Typeface name": "Wingdings", "Dingbat dec": "136", "Dingbat hex": "88", "Unicode dec": "10119", "Unicode hex": "2787" },
    { "Typeface name": "Wingdings", "Dingbat dec": "137", "Dingbat hex": "89", "Unicode dec": "10120", "Unicode hex": "2788" },
    { "Typeface name": "Wingdings", "Dingbat dec": "138", "Dingbat hex": "8A", "Unicode dec": "10121", "Unicode hex": "2789" },
    { "Typeface name": "Wingdings", "Dingbat dec": "139", "Dingbat hex": "8B", "Unicode dec": "127244", "Unicode hex": "1F10C" },
    { "Typeface name": "Wingdings", "Dingbat dec": "140", "Dingbat hex": "8C", "Unicode dec": "10122", "Unicode hex": "278A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "141", "Dingbat hex": "8D", "Unicode dec": "10123", "Unicode hex": "278B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "142", "Dingbat hex": "8E", "Unicode dec": "10124", "Unicode hex": "278C" },
    { "Typeface name": "Wingdings", "Dingbat dec": "143", "Dingbat hex": "8F", "Unicode dec": "10125", "Unicode hex": "278D" },
    { "Typeface name": "Wingdings", "Dingbat dec": "144", "Dingbat hex": "90", "Unicode dec": "10126", "Unicode hex": "278E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "145", "Dingbat hex": "91", "Unicode dec": "10127", "Unicode hex": "278F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "146", "Dingbat hex": "92", "Unicode dec": "10128", "Unicode hex": "2790" },
    { "Typeface name": "Wingdings", "Dingbat dec": "147", "Dingbat hex": "93", "Unicode dec": "10129", "Unicode hex": "2791" },
    { "Typeface name": "Wingdings", "Dingbat dec": "148", "Dingbat hex": "94", "Unicode dec": "10130", "Unicode hex": "2792" },
    { "Typeface name": "Wingdings", "Dingbat dec": "149", "Dingbat hex": "95", "Unicode dec": "10131", "Unicode hex": "2793" },
    { "Typeface name": "Wingdings", "Dingbat dec": "150", "Dingbat hex": "96", "Unicode dec": "128610", "Unicode hex": "1F662" },
    { "Typeface name": "Wingdings", "Dingbat dec": "151", "Dingbat hex": "97", "Unicode dec": "128608", "Unicode hex": "1F660" },
    { "Typeface name": "Wingdings", "Dingbat dec": "152", "Dingbat hex": "98", "Unicode dec": "128609", "Unicode hex": "1F661" },
    { "Typeface name": "Wingdings", "Dingbat dec": "153", "Dingbat hex": "99", "Unicode dec": "128611", "Unicode hex": "1F663" },
    { "Typeface name": "Wingdings", "Dingbat dec": "154", "Dingbat hex": "9A", "Unicode dec": "128606", "Unicode hex": "1F65E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "155", "Dingbat hex": "9B", "Unicode dec": "128604", "Unicode hex": "1F65C" },
    { "Typeface name": "Wingdings", "Dingbat dec": "156", "Dingbat hex": "9C", "Unicode dec": "128605", "Unicode hex": "1F65D" },
    { "Typeface name": "Wingdings", "Dingbat dec": "157", "Dingbat hex": "9D", "Unicode dec": "128607", "Unicode hex": "1F65F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "158", "Dingbat hex": "9E", "Unicode dec": "8729", "Unicode hex": "2219" },
    { "Typeface name": "Wingdings", "Dingbat dec": "159", "Dingbat hex": "9F", "Unicode dec": "8226", "Unicode hex": "2022" },
    { "Typeface name": "Wingdings", "Dingbat dec": "160", "Dingbat hex": "A0", "Unicode dec": "11037", "Unicode hex": "2B1D" },
    { "Typeface name": "Wingdings", "Dingbat dec": "161", "Dingbat hex": "A1", "Unicode dec": "11096", "Unicode hex": "2B58" },
    { "Typeface name": "Wingdings", "Dingbat dec": "162", "Dingbat hex": "A2", "Unicode dec": "128902", "Unicode hex": "1F786" },
    { "Typeface name": "Wingdings", "Dingbat dec": "163", "Dingbat hex": "A3", "Unicode dec": "128904", "Unicode hex": "1F788" },
    { "Typeface name": "Wingdings", "Dingbat dec": "164", "Dingbat hex": "A4", "Unicode dec": "128906", "Unicode hex": "1F78A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "165", "Dingbat hex": "A5", "Unicode dec": "128907", "Unicode hex": "1F78B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "166", "Dingbat hex": "A6", "Unicode dec": "128319", "Unicode hex": "1F53F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "167", "Dingbat hex": "A7", "Unicode dec": "9642", "Unicode hex": "25AA" },
    { "Typeface name": "Wingdings", "Dingbat dec": "168", "Dingbat hex": "A8", "Unicode dec": "128910", "Unicode hex": "1F78E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "169", "Dingbat hex": "A9", "Unicode dec": "128961", "Unicode hex": "1F7C1" },
    { "Typeface name": "Wingdings", "Dingbat dec": "170", "Dingbat hex": "AA", "Unicode dec": "128965", "Unicode hex": "1F7C5" },
    { "Typeface name": "Wingdings", "Dingbat dec": "171", "Dingbat hex": "AB", "Unicode dec": "9733", "Unicode hex": "2605" },
    { "Typeface name": "Wingdings", "Dingbat dec": "172", "Dingbat hex": "AC", "Unicode dec": "128971", "Unicode hex": "1F7CB" },
    { "Typeface name": "Wingdings", "Dingbat dec": "173", "Dingbat hex": "AD", "Unicode dec": "128975", "Unicode hex": "1F7CF" },
    { "Typeface name": "Wingdings", "Dingbat dec": "174", "Dingbat hex": "AE", "Unicode dec": "128979", "Unicode hex": "1F7D3" },
    { "Typeface name": "Wingdings", "Dingbat dec": "175", "Dingbat hex": "AF", "Unicode dec": "128977", "Unicode hex": "1F7D1" },
    { "Typeface name": "Wingdings", "Dingbat dec": "176", "Dingbat hex": "B0", "Unicode dec": "11216", "Unicode hex": "2BD0" },
    { "Typeface name": "Wingdings", "Dingbat dec": "177", "Dingbat hex": "B1", "Unicode dec": "8982", "Unicode hex": "2316" },
    { "Typeface name": "Wingdings", "Dingbat dec": "178", "Dingbat hex": "B2", "Unicode dec": "11214", "Unicode hex": "2BCE" },
    { "Typeface name": "Wingdings", "Dingbat dec": "179", "Dingbat hex": "B3", "Unicode dec": "11215", "Unicode hex": "2BCF" },
    { "Typeface name": "Wingdings", "Dingbat dec": "180", "Dingbat hex": "B4", "Unicode dec": "11217", "Unicode hex": "2BD1" },
    { "Typeface name": "Wingdings", "Dingbat dec": "181", "Dingbat hex": "B5", "Unicode dec": "10026", "Unicode hex": "272A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "182", "Dingbat hex": "B6", "Unicode dec": "10032", "Unicode hex": "2730" },
    { "Typeface name": "Wingdings", "Dingbat dec": "183", "Dingbat hex": "B7", "Unicode dec": "128336", "Unicode hex": "1F550" },
    { "Typeface name": "Wingdings", "Dingbat dec": "184", "Dingbat hex": "B8", "Unicode dec": "128337", "Unicode hex": "1F551" },
    { "Typeface name": "Wingdings", "Dingbat dec": "185", "Dingbat hex": "B9", "Unicode dec": "128338", "Unicode hex": "1F552" },
    { "Typeface name": "Wingdings", "Dingbat dec": "186", "Dingbat hex": "BA", "Unicode dec": "128339", "Unicode hex": "1F553" },
    { "Typeface name": "Wingdings", "Dingbat dec": "187", "Dingbat hex": "BB", "Unicode dec": "128340", "Unicode hex": "1F554" },
    { "Typeface name": "Wingdings", "Dingbat dec": "188", "Dingbat hex": "BC", "Unicode dec": "128341", "Unicode hex": "1F555" },
    { "Typeface name": "Wingdings", "Dingbat dec": "189", "Dingbat hex": "BD", "Unicode dec": "128342", "Unicode hex": "1F556" },
    { "Typeface name": "Wingdings", "Dingbat dec": "190", "Dingbat hex": "BE", "Unicode dec": "128343", "Unicode hex": "1F557" },
    { "Typeface name": "Wingdings", "Dingbat dec": "191", "Dingbat hex": "BF", "Unicode dec": "128344", "Unicode hex": "1F558" },
    { "Typeface name": "Wingdings", "Dingbat dec": "192", "Dingbat hex": "C0", "Unicode dec": "128345", "Unicode hex": "1F559" },
    { "Typeface name": "Wingdings", "Dingbat dec": "193", "Dingbat hex": "C1", "Unicode dec": "128346", "Unicode hex": "1F55A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "194", "Dingbat hex": "C2", "Unicode dec": "128347", "Unicode hex": "1F55B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "195", "Dingbat hex": "C3", "Unicode dec": "11184", "Unicode hex": "2BB0" },
    { "Typeface name": "Wingdings", "Dingbat dec": "196", "Dingbat hex": "C4", "Unicode dec": "11185", "Unicode hex": "2BB1" },
    { "Typeface name": "Wingdings", "Dingbat dec": "197", "Dingbat hex": "C5", "Unicode dec": "11186", "Unicode hex": "2BB2" },
    { "Typeface name": "Wingdings", "Dingbat dec": "198", "Dingbat hex": "C6", "Unicode dec": "11187", "Unicode hex": "2BB3" },
    { "Typeface name": "Wingdings", "Dingbat dec": "199", "Dingbat hex": "C7", "Unicode dec": "11188", "Unicode hex": "2BB4" },
    { "Typeface name": "Wingdings", "Dingbat dec": "200", "Dingbat hex": "C8", "Unicode dec": "11189", "Unicode hex": "2BB5" },
    { "Typeface name": "Wingdings", "Dingbat dec": "201", "Dingbat hex": "C9", "Unicode dec": "11190", "Unicode hex": "2BB6" },
    { "Typeface name": "Wingdings", "Dingbat dec": "202", "Dingbat hex": "CA", "Unicode dec": "11191", "Unicode hex": "2BB7" },
    { "Typeface name": "Wingdings", "Dingbat dec": "203", "Dingbat hex": "CB", "Unicode dec": "128618", "Unicode hex": "1F66A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "204", "Dingbat hex": "CC", "Unicode dec": "128619", "Unicode hex": "1F66B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "205", "Dingbat hex": "CD", "Unicode dec": "128597", "Unicode hex": "1F655" },
    { "Typeface name": "Wingdings", "Dingbat dec": "206", "Dingbat hex": "CE", "Unicode dec": "128596", "Unicode hex": "1F654" },
    { "Typeface name": "Wingdings", "Dingbat dec": "207", "Dingbat hex": "CF", "Unicode dec": "128599", "Unicode hex": "1F657" },
    { "Typeface name": "Wingdings", "Dingbat dec": "208", "Dingbat hex": "D0", "Unicode dec": "128598", "Unicode hex": "1F656" },
    { "Typeface name": "Wingdings", "Dingbat dec": "209", "Dingbat hex": "D1", "Unicode dec": "128592", "Unicode hex": "1F650" },
    { "Typeface name": "Wingdings", "Dingbat dec": "210", "Dingbat hex": "D2", "Unicode dec": "128593", "Unicode hex": "1F651" },
    { "Typeface name": "Wingdings", "Dingbat dec": "211", "Dingbat hex": "D3", "Unicode dec": "128594", "Unicode hex": "1F652" },
    { "Typeface name": "Wingdings", "Dingbat dec": "212", "Dingbat hex": "D4", "Unicode dec": "128595", "Unicode hex": "1F653" },
    { "Typeface name": "Wingdings", "Dingbat dec": "213", "Dingbat hex": "D5", "Unicode dec": "9003", "Unicode hex": "232B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "214", "Dingbat hex": "D6", "Unicode dec": "8998", "Unicode hex": "2326" },
    { "Typeface name": "Wingdings", "Dingbat dec": "215", "Dingbat hex": "D7", "Unicode dec": "11160", "Unicode hex": "2B98" },
    { "Typeface name": "Wingdings", "Dingbat dec": "216", "Dingbat hex": "D8", "Unicode dec": "11162", "Unicode hex": "2B9A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "217", "Dingbat hex": "D9", "Unicode dec": "11161", "Unicode hex": "2B99" },
    { "Typeface name": "Wingdings", "Dingbat dec": "218", "Dingbat hex": "DA", "Unicode dec": "11163", "Unicode hex": "2B9B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "219", "Dingbat hex": "DB", "Unicode dec": "11144", "Unicode hex": "2B88" },
    { "Typeface name": "Wingdings", "Dingbat dec": "220", "Dingbat hex": "DC", "Unicode dec": "11146", "Unicode hex": "2B8A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "221", "Dingbat hex": "DD", "Unicode dec": "11145", "Unicode hex": "2B89" },
    { "Typeface name": "Wingdings", "Dingbat dec": "222", "Dingbat hex": "DE", "Unicode dec": "11147", "Unicode hex": "2B8B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "223", "Dingbat hex": "DF", "Unicode dec": "129128", "Unicode hex": "1F868" },
    { "Typeface name": "Wingdings", "Dingbat dec": "224", "Dingbat hex": "E0", "Unicode dec": "129130", "Unicode hex": "1F86A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "225", "Dingbat hex": "E1", "Unicode dec": "129129", "Unicode hex": "1F869" },
    { "Typeface name": "Wingdings", "Dingbat dec": "226", "Dingbat hex": "E2", "Unicode dec": "129131", "Unicode hex": "1F86B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "227", "Dingbat hex": "E3", "Unicode dec": "129132", "Unicode hex": "1F86C" },
    { "Typeface name": "Wingdings", "Dingbat dec": "228", "Dingbat hex": "E4", "Unicode dec": "129133", "Unicode hex": "1F86D" },
    { "Typeface name": "Wingdings", "Dingbat dec": "229", "Dingbat hex": "E5", "Unicode dec": "129135", "Unicode hex": "1F86F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "230", "Dingbat hex": "E6", "Unicode dec": "129134", "Unicode hex": "1F86E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "231", "Dingbat hex": "E7", "Unicode dec": "129144", "Unicode hex": "1F878" },
    { "Typeface name": "Wingdings", "Dingbat dec": "232", "Dingbat hex": "E8", "Unicode dec": "129146", "Unicode hex": "1F87A" },
    { "Typeface name": "Wingdings", "Dingbat dec": "233", "Dingbat hex": "E9", "Unicode dec": "129145", "Unicode hex": "1F879" },
    { "Typeface name": "Wingdings", "Dingbat dec": "234", "Dingbat hex": "EA", "Unicode dec": "129147", "Unicode hex": "1F87B" },
    { "Typeface name": "Wingdings", "Dingbat dec": "235", "Dingbat hex": "EB", "Unicode dec": "129148", "Unicode hex": "1F87C" },
    { "Typeface name": "Wingdings", "Dingbat dec": "236", "Dingbat hex": "EC", "Unicode dec": "129149", "Unicode hex": "1F87D" },
    { "Typeface name": "Wingdings", "Dingbat dec": "237", "Dingbat hex": "ED", "Unicode dec": "129151", "Unicode hex": "1F87F" },
    { "Typeface name": "Wingdings", "Dingbat dec": "238", "Dingbat hex": "EE", "Unicode dec": "129150", "Unicode hex": "1F87E" },
    { "Typeface name": "Wingdings", "Dingbat dec": "239", "Dingbat hex": "EF", "Unicode dec": "8678", "Unicode hex": "21E6" },
    { "Typeface name": "Wingdings", "Dingbat dec": "240", "Dingbat hex": "F0", "Unicode dec": "8680", "Unicode hex": "21E8" },
    { "Typeface name": "Wingdings", "Dingbat dec": "241", "Dingbat hex": "F1", "Unicode dec": "8679", "Unicode hex": "21E7" },
    { "Typeface name": "Wingdings", "Dingbat dec": "242", "Dingbat hex": "F2", "Unicode dec": "8681", "Unicode hex": "21E9" },
    { "Typeface name": "Wingdings", "Dingbat dec": "243", "Dingbat hex": "F3", "Unicode dec": "11012", "Unicode hex": "2B04" },
    { "Typeface name": "Wingdings", "Dingbat dec": "244", "Dingbat hex": "F4", "Unicode dec": "8691", "Unicode hex": "21F3" },
    { "Typeface name": "Wingdings", "Dingbat dec": "245", "Dingbat hex": "F5", "Unicode dec": "11009", "Unicode hex": "2B01" },
    { "Typeface name": "Wingdings", "Dingbat dec": "246", "Dingbat hex": "F6", "Unicode dec": "11008", "Unicode hex": "2B00" },
    { "Typeface name": "Wingdings", "Dingbat dec": "247", "Dingbat hex": "F7", "Unicode dec": "11011", "Unicode hex": "2B03" },
    { "Typeface name": "Wingdings", "Dingbat dec": "248", "Dingbat hex": "F8", "Unicode dec": "11010", "Unicode hex": "2B02" },
    { "Typeface name": "Wingdings", "Dingbat dec": "249", "Dingbat hex": "F9", "Unicode dec": "129196", "Unicode hex": "1F8AC" },
    { "Typeface name": "Wingdings", "Dingbat dec": "250", "Dingbat hex": "FA", "Unicode dec": "129197", "Unicode hex": "1F8AD" },
    { "Typeface name": "Wingdings", "Dingbat dec": "251", "Dingbat hex": "FB", "Unicode dec": "128502", "Unicode hex": "1F5F6" },
    { "Typeface name": "Wingdings", "Dingbat dec": "252", "Dingbat hex": "FC", "Unicode dec": "10003", "Unicode hex": "2713" },
    { "Typeface name": "Wingdings", "Dingbat dec": "253", "Dingbat hex": "FD", "Unicode dec": "128503", "Unicode hex": "1F5F7" },
    { "Typeface name": "Wingdings", "Dingbat dec": "254", "Dingbat hex": "FE", "Unicode dec": "128505", "Unicode hex": "1F5F9" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "32", "Dingbat hex": "20", "Unicode dec": "32", "Unicode hex": "20" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "33", "Dingbat hex": "21", "Unicode dec": "128394", "Unicode hex": "1F58A" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "34", "Dingbat hex": "22", "Unicode dec": "128395", "Unicode hex": "1F58B" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "35", "Dingbat hex": "23", "Unicode dec": "128396", "Unicode hex": "1F58C" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "36", "Dingbat hex": "24", "Unicode dec": "128397", "Unicode hex": "1F58D" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "37", "Dingbat hex": "25", "Unicode dec": "9988", "Unicode hex": "2704" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "38", "Dingbat hex": "26", "Unicode dec": "9984", "Unicode hex": "2700" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "39", "Dingbat hex": "27", "Unicode dec": "128382", "Unicode hex": "1F57E" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "40", "Dingbat hex": "28", "Unicode dec": "128381", "Unicode hex": "1F57D" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "41", "Dingbat hex": "29", "Unicode dec": "128453", "Unicode hex": "1F5C5" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "42", "Dingbat hex": "2A", "Unicode dec": "128454", "Unicode hex": "1F5C6" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "43", "Dingbat hex": "2B", "Unicode dec": "128455", "Unicode hex": "1F5C7" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "44", "Dingbat hex": "2C", "Unicode dec": "128456", "Unicode hex": "1F5C8" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "45", "Dingbat hex": "2D", "Unicode dec": "128457", "Unicode hex": "1F5C9" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "46", "Dingbat hex": "2E", "Unicode dec": "128458", "Unicode hex": "1F5CA" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "47", "Dingbat hex": "2F", "Unicode dec": "128459", "Unicode hex": "1F5CB" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "48", "Dingbat hex": "30", "Unicode dec": "128460", "Unicode hex": "1F5CC" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "49", "Dingbat hex": "31", "Unicode dec": "128461", "Unicode hex": "1F5CD" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "50", "Dingbat hex": "32", "Unicode dec": "128203", "Unicode hex": "1F4CB" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "51", "Dingbat hex": "33", "Unicode dec": "128465", "Unicode hex": "1F5D1" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "52", "Dingbat hex": "34", "Unicode dec": "128468", "Unicode hex": "1F5D4" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "53", "Dingbat hex": "35", "Unicode dec": "128437", "Unicode hex": "1F5B5" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "54", "Dingbat hex": "36", "Unicode dec": "128438", "Unicode hex": "1F5B6" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "55", "Dingbat hex": "37", "Unicode dec": "128439", "Unicode hex": "1F5B7" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "56", "Dingbat hex": "38", "Unicode dec": "128440", "Unicode hex": "1F5B8" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "57", "Dingbat hex": "39", "Unicode dec": "128429", "Unicode hex": "1F5AD" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "58", "Dingbat hex": "3A", "Unicode dec": "128431", "Unicode hex": "1F5AF" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "59", "Dingbat hex": "3B", "Unicode dec": "128433", "Unicode hex": "1F5B1" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "60", "Dingbat hex": "3C", "Unicode dec": "128402", "Unicode hex": "1F592" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "61", "Dingbat hex": "3D", "Unicode dec": "128403", "Unicode hex": "1F593" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "62", "Dingbat hex": "3E", "Unicode dec": "128408", "Unicode hex": "1F598" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "63", "Dingbat hex": "3F", "Unicode dec": "128409", "Unicode hex": "1F599" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "64", "Dingbat hex": "40", "Unicode dec": "128410", "Unicode hex": "1F59A" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "65", "Dingbat hex": "41", "Unicode dec": "128411", "Unicode hex": "1F59B" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "66", "Dingbat hex": "42", "Unicode dec": "128072", "Unicode hex": "1F448" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "67", "Dingbat hex": "43", "Unicode dec": "128073", "Unicode hex": "1F449" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "68", "Dingbat hex": "44", "Unicode dec": "128412", "Unicode hex": "1F59C" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "69", "Dingbat hex": "45", "Unicode dec": "128413", "Unicode hex": "1F59D" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "70", "Dingbat hex": "46", "Unicode dec": "128414", "Unicode hex": "1F59E" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "71", "Dingbat hex": "47", "Unicode dec": "128415", "Unicode hex": "1F59F" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "72", "Dingbat hex": "48", "Unicode dec": "128416", "Unicode hex": "1F5A0" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "73", "Dingbat hex": "49", "Unicode dec": "128417", "Unicode hex": "1F5A1" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "74", "Dingbat hex": "4A", "Unicode dec": "128070", "Unicode hex": "1F446" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "75", "Dingbat hex": "4B", "Unicode dec": "128071", "Unicode hex": "1F447" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "76", "Dingbat hex": "4C", "Unicode dec": "128418", "Unicode hex": "1F5A2" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "77", "Dingbat hex": "4D", "Unicode dec": "128419", "Unicode hex": "1F5A3" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "78", "Dingbat hex": "4E", "Unicode dec": "128401", "Unicode hex": "1F591" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "79", "Dingbat hex": "4F", "Unicode dec": "128500", "Unicode hex": "1F5F4" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "80", "Dingbat hex": "50", "Unicode dec": "128504", "Unicode hex": "1F5F8" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "81", "Dingbat hex": "51", "Unicode dec": "128501", "Unicode hex": "1F5F5" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "82", "Dingbat hex": "52", "Unicode dec": "9745", "Unicode hex": "2611" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "83", "Dingbat hex": "53", "Unicode dec": "11197", "Unicode hex": "2BBD" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "84", "Dingbat hex": "54", "Unicode dec": "9746", "Unicode hex": "2612" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "85", "Dingbat hex": "55", "Unicode dec": "11198", "Unicode hex": "2BBE" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "86", "Dingbat hex": "56", "Unicode dec": "11199", "Unicode hex": "2BBF" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "87", "Dingbat hex": "57", "Unicode dec": "128711", "Unicode hex": "1F6C7" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "88", "Dingbat hex": "58", "Unicode dec": "10680", "Unicode hex": "29B8" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "89", "Dingbat hex": "59", "Unicode dec": "128625", "Unicode hex": "1F671" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "90", "Dingbat hex": "5A", "Unicode dec": "128628", "Unicode hex": "1F674" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "91", "Dingbat hex": "5B", "Unicode dec": "128626", "Unicode hex": "1F672" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "92", "Dingbat hex": "5C", "Unicode dec": "128627", "Unicode hex": "1F673" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "93", "Dingbat hex": "5D", "Unicode dec": "8253", "Unicode hex": "203D" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "94", "Dingbat hex": "5E", "Unicode dec": "128633", "Unicode hex": "1F679" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "95", "Dingbat hex": "5F", "Unicode dec": "128634", "Unicode hex": "1F67A" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "96", "Dingbat hex": "60", "Unicode dec": "128635", "Unicode hex": "1F67B" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "97", "Dingbat hex": "61", "Unicode dec": "128614", "Unicode hex": "1F666" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "98", "Dingbat hex": "62", "Unicode dec": "128612", "Unicode hex": "1F664" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "99", "Dingbat hex": "63", "Unicode dec": "128613", "Unicode hex": "1F665" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "100", "Dingbat hex": "64", "Unicode dec": "128615", "Unicode hex": "1F667" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "101", "Dingbat hex": "65", "Unicode dec": "128602", "Unicode hex": "1F65A" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "102", "Dingbat hex": "66", "Unicode dec": "128600", "Unicode hex": "1F658" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "103", "Dingbat hex": "67", "Unicode dec": "128601", "Unicode hex": "1F659" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "104", "Dingbat hex": "68", "Unicode dec": "128603", "Unicode hex": "1F65B" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "105", "Dingbat hex": "69", "Unicode dec": "9450", "Unicode hex": "24EA" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "106", "Dingbat hex": "6A", "Unicode dec": "9312", "Unicode hex": "2460" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "107", "Dingbat hex": "6B", "Unicode dec": "9313", "Unicode hex": "2461" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "108", "Dingbat hex": "6C", "Unicode dec": "9314", "Unicode hex": "2462" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "109", "Dingbat hex": "6D", "Unicode dec": "9315", "Unicode hex": "2463" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "110", "Dingbat hex": "6E", "Unicode dec": "9316", "Unicode hex": "2464" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "111", "Dingbat hex": "6F", "Unicode dec": "9317", "Unicode hex": "2465" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "112", "Dingbat hex": "70", "Unicode dec": "9318", "Unicode hex": "2466" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "113", "Dingbat hex": "71", "Unicode dec": "9319", "Unicode hex": "2467" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "114", "Dingbat hex": "72", "Unicode dec": "9320", "Unicode hex": "2468" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "115", "Dingbat hex": "73", "Unicode dec": "9321", "Unicode hex": "2469" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "116", "Dingbat hex": "74", "Unicode dec": "9471", "Unicode hex": "24FF" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "117", "Dingbat hex": "75", "Unicode dec": "10102", "Unicode hex": "2776" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "118", "Dingbat hex": "76", "Unicode dec": "10103", "Unicode hex": "2777" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "119", "Dingbat hex": "77", "Unicode dec": "10104", "Unicode hex": "2778" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "120", "Dingbat hex": "78", "Unicode dec": "10105", "Unicode hex": "2779" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "121", "Dingbat hex": "79", "Unicode dec": "10106", "Unicode hex": "277A" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "122", "Dingbat hex": "7A", "Unicode dec": "10107", "Unicode hex": "277B" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "123", "Dingbat hex": "7B", "Unicode dec": "10108", "Unicode hex": "277C" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "124", "Dingbat hex": "7C", "Unicode dec": "10109", "Unicode hex": "277D" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "125", "Dingbat hex": "7D", "Unicode dec": "10110", "Unicode hex": "277E" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "126", "Dingbat hex": "7E", "Unicode dec": "10111", "Unicode hex": "277F" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "128", "Dingbat hex": "80", "Unicode dec": "9737", "Unicode hex": "2609" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "129", "Dingbat hex": "81", "Unicode dec": "127765", "Unicode hex": "1F315" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "130", "Dingbat hex": "82", "Unicode dec": "9789", "Unicode hex": "263D" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "131", "Dingbat hex": "83", "Unicode dec": "9790", "Unicode hex": "263E" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "132", "Dingbat hex": "84", "Unicode dec": "11839", "Unicode hex": "2E3F" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "133", "Dingbat hex": "85", "Unicode dec": "10013", "Unicode hex": "271D" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "134", "Dingbat hex": "86", "Unicode dec": "128327", "Unicode hex": "1F547" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "135", "Dingbat hex": "87", "Unicode dec": "128348", "Unicode hex": "1F55C" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "136", "Dingbat hex": "88", "Unicode dec": "128349", "Unicode hex": "1F55D" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "137", "Dingbat hex": "89", "Unicode dec": "128350", "Unicode hex": "1F55E" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "138", "Dingbat hex": "8A", "Unicode dec": "128351", "Unicode hex": "1F55F" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "139", "Dingbat hex": "8B", "Unicode dec": "128352", "Unicode hex": "1F560" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "140", "Dingbat hex": "8C", "Unicode dec": "128353", "Unicode hex": "1F561" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "141", "Dingbat hex": "8D", "Unicode dec": "128354", "Unicode hex": "1F562" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "142", "Dingbat hex": "8E", "Unicode dec": "128355", "Unicode hex": "1F563" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "143", "Dingbat hex": "8F", "Unicode dec": "128356", "Unicode hex": "1F564" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "144", "Dingbat hex": "90", "Unicode dec": "128357", "Unicode hex": "1F565" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "145", "Dingbat hex": "91", "Unicode dec": "128358", "Unicode hex": "1F566" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "146", "Dingbat hex": "92", "Unicode dec": "128359", "Unicode hex": "1F567" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "147", "Dingbat hex": "93", "Unicode dec": "128616", "Unicode hex": "1F668" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "148", "Dingbat hex": "94", "Unicode dec": "128617", "Unicode hex": "1F669" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "149", "Dingbat hex": "95", "Unicode dec": "8901", "Unicode hex": "22C5" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "150", "Dingbat hex": "96", "Unicode dec": "128900", "Unicode hex": "1F784" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "151", "Dingbat hex": "97", "Unicode dec": "10625", "Unicode hex": "2981" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "152", "Dingbat hex": "98", "Unicode dec": "9679", "Unicode hex": "25CF" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "153", "Dingbat hex": "99", "Unicode dec": "9675", "Unicode hex": "25CB" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "154", "Dingbat hex": "9A", "Unicode dec": "128901", "Unicode hex": "1F785" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "155", "Dingbat hex": "9B", "Unicode dec": "128903", "Unicode hex": "1F787" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "156", "Dingbat hex": "9C", "Unicode dec": "128905", "Unicode hex": "1F789" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "157", "Dingbat hex": "9D", "Unicode dec": "8857", "Unicode hex": "2299" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "158", "Dingbat hex": "9E", "Unicode dec": "10687", "Unicode hex": "29BF" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "159", "Dingbat hex": "9F", "Unicode dec": "128908", "Unicode hex": "1F78C" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "160", "Dingbat hex": "A0", "Unicode dec": "128909", "Unicode hex": "1F78D" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "161", "Dingbat hex": "A1", "Unicode dec": "9726", "Unicode hex": "25FE" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "162", "Dingbat hex": "A2", "Unicode dec": "9632", "Unicode hex": "25A0" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "163", "Dingbat hex": "A3", "Unicode dec": "9633", "Unicode hex": "25A1" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "164", "Dingbat hex": "A4", "Unicode dec": "128913", "Unicode hex": "1F791" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "165", "Dingbat hex": "A5", "Unicode dec": "128914", "Unicode hex": "1F792" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "166", "Dingbat hex": "A6", "Unicode dec": "128915", "Unicode hex": "1F793" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "167", "Dingbat hex": "A7", "Unicode dec": "128916", "Unicode hex": "1F794" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "168", "Dingbat hex": "A8", "Unicode dec": "9635", "Unicode hex": "25A3" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "169", "Dingbat hex": "A9", "Unicode dec": "128917", "Unicode hex": "1F795" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "170", "Dingbat hex": "AA", "Unicode dec": "128918", "Unicode hex": "1F796" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "171", "Dingbat hex": "AB", "Unicode dec": "128919", "Unicode hex": "1F797" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "172", "Dingbat hex": "AC", "Unicode dec": "128920", "Unicode hex": "1F798" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "173", "Dingbat hex": "AD", "Unicode dec": "11049", "Unicode hex": "2B29" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "174", "Dingbat hex": "AE", "Unicode dec": "11045", "Unicode hex": "2B25" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "175", "Dingbat hex": "AF", "Unicode dec": "9671", "Unicode hex": "25C7" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "176", "Dingbat hex": "B0", "Unicode dec": "128922", "Unicode hex": "1F79A" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "177", "Dingbat hex": "B1", "Unicode dec": "9672", "Unicode hex": "25C8" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "178", "Dingbat hex": "B2", "Unicode dec": "128923", "Unicode hex": "1F79B" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "179", "Dingbat hex": "B3", "Unicode dec": "128924", "Unicode hex": "1F79C" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "180", "Dingbat hex": "B4", "Unicode dec": "128925", "Unicode hex": "1F79D" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "181", "Dingbat hex": "B5", "Unicode dec": "128926", "Unicode hex": "1F79E" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "182", "Dingbat hex": "B6", "Unicode dec": "11050", "Unicode hex": "2B2A" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "183", "Dingbat hex": "B7", "Unicode dec": "11047", "Unicode hex": "2B27" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "184", "Dingbat hex": "B8", "Unicode dec": "9674", "Unicode hex": "25CA" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "185", "Dingbat hex": "B9", "Unicode dec": "128928", "Unicode hex": "1F7A0" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "186", "Dingbat hex": "BA", "Unicode dec": "9686", "Unicode hex": "25D6" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "187", "Dingbat hex": "BB", "Unicode dec": "9687", "Unicode hex": "25D7" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "188", "Dingbat hex": "BC", "Unicode dec": "11210", "Unicode hex": "2BCA" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "189", "Dingbat hex": "BD", "Unicode dec": "11211", "Unicode hex": "2BCB" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "190", "Dingbat hex": "BE", "Unicode dec": "11200", "Unicode hex": "2BC0" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "191", "Dingbat hex": "BF", "Unicode dec": "11201", "Unicode hex": "2BC1" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "192", "Dingbat hex": "C0", "Unicode dec": "11039", "Unicode hex": "2B1F" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "193", "Dingbat hex": "C1", "Unicode dec": "11202", "Unicode hex": "2BC2" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "194", "Dingbat hex": "C2", "Unicode dec": "11043", "Unicode hex": "2B23" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "195", "Dingbat hex": "C3", "Unicode dec": "11042", "Unicode hex": "2B22" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "196", "Dingbat hex": "C4", "Unicode dec": "11203", "Unicode hex": "2BC3" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "197", "Dingbat hex": "C5", "Unicode dec": "11204", "Unicode hex": "2BC4" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "198", "Dingbat hex": "C6", "Unicode dec": "128929", "Unicode hex": "1F7A1" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "199", "Dingbat hex": "C7", "Unicode dec": "128930", "Unicode hex": "1F7A2" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "200", "Dingbat hex": "C8", "Unicode dec": "128931", "Unicode hex": "1F7A3" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "201", "Dingbat hex": "C9", "Unicode dec": "128932", "Unicode hex": "1F7A4" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "202", "Dingbat hex": "CA", "Unicode dec": "128933", "Unicode hex": "1F7A5" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "203", "Dingbat hex": "CB", "Unicode dec": "128934", "Unicode hex": "1F7A6" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "204", "Dingbat hex": "CC", "Unicode dec": "128935", "Unicode hex": "1F7A7" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "205", "Dingbat hex": "CD", "Unicode dec": "128936", "Unicode hex": "1F7A8" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "206", "Dingbat hex": "CE", "Unicode dec": "128937", "Unicode hex": "1F7A9" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "207", "Dingbat hex": "CF", "Unicode dec": "128938", "Unicode hex": "1F7AA" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "208", "Dingbat hex": "D0", "Unicode dec": "128939", "Unicode hex": "1F7AB" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "209", "Dingbat hex": "D1", "Unicode dec": "128940", "Unicode hex": "1F7AC" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "210", "Dingbat hex": "D2", "Unicode dec": "128941", "Unicode hex": "1F7AD" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "211", "Dingbat hex": "D3", "Unicode dec": "128942", "Unicode hex": "1F7AE" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "212", "Dingbat hex": "D4", "Unicode dec": "128943", "Unicode hex": "1F7AF" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "213", "Dingbat hex": "D5", "Unicode dec": "128944", "Unicode hex": "1F7B0" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "214", "Dingbat hex": "D6", "Unicode dec": "128945", "Unicode hex": "1F7B1" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "215", "Dingbat hex": "D7", "Unicode dec": "128946", "Unicode hex": "1F7B2" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "216", "Dingbat hex": "D8", "Unicode dec": "128947", "Unicode hex": "1F7B3" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "217", "Dingbat hex": "D9", "Unicode dec": "128948", "Unicode hex": "1F7B4" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "218", "Dingbat hex": "DA", "Unicode dec": "128949", "Unicode hex": "1F7B5" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "219", "Dingbat hex": "DB", "Unicode dec": "128950", "Unicode hex": "1F7B6" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "220", "Dingbat hex": "DC", "Unicode dec": "128951", "Unicode hex": "1F7B7" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "221", "Dingbat hex": "DD", "Unicode dec": "128952", "Unicode hex": "1F7B8" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "222", "Dingbat hex": "DE", "Unicode dec": "128953", "Unicode hex": "1F7B9" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "223", "Dingbat hex": "DF", "Unicode dec": "128954", "Unicode hex": "1F7BA" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "224", "Dingbat hex": "E0", "Unicode dec": "128955", "Unicode hex": "1F7BB" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "225", "Dingbat hex": "E1", "Unicode dec": "128956", "Unicode hex": "1F7BC" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "226", "Dingbat hex": "E2", "Unicode dec": "128957", "Unicode hex": "1F7BD" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "227", "Dingbat hex": "E3", "Unicode dec": "128958", "Unicode hex": "1F7BE" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "228", "Dingbat hex": "E4", "Unicode dec": "128959", "Unicode hex": "1F7BF" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "229", "Dingbat hex": "E5", "Unicode dec": "128960", "Unicode hex": "1F7C0" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "230", "Dingbat hex": "E6", "Unicode dec": "128962", "Unicode hex": "1F7C2" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "231", "Dingbat hex": "E7", "Unicode dec": "128964", "Unicode hex": "1F7C4" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "232", "Dingbat hex": "E8", "Unicode dec": "128966", "Unicode hex": "1F7C6" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "233", "Dingbat hex": "E9", "Unicode dec": "128969", "Unicode hex": "1F7C9" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "234", "Dingbat hex": "EA", "Unicode dec": "128970", "Unicode hex": "1F7CA" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "235", "Dingbat hex": "EB", "Unicode dec": "10038", "Unicode hex": "2736" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "236", "Dingbat hex": "EC", "Unicode dec": "128972", "Unicode hex": "1F7CC" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "237", "Dingbat hex": "ED", "Unicode dec": "128974", "Unicode hex": "1F7CE" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "238", "Dingbat hex": "EE", "Unicode dec": "128976", "Unicode hex": "1F7D0" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "239", "Dingbat hex": "EF", "Unicode dec": "128978", "Unicode hex": "1F7D2" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "240", "Dingbat hex": "F0", "Unicode dec": "10041", "Unicode hex": "2739" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "241", "Dingbat hex": "F1", "Unicode dec": "128963", "Unicode hex": "1F7C3" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "242", "Dingbat hex": "F2", "Unicode dec": "128967", "Unicode hex": "1F7C7" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "243", "Dingbat hex": "F3", "Unicode dec": "10031", "Unicode hex": "272F" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "244", "Dingbat hex": "F4", "Unicode dec": "128973", "Unicode hex": "1F7CD" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "245", "Dingbat hex": "F5", "Unicode dec": "128980", "Unicode hex": "1F7D4" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "246", "Dingbat hex": "F6", "Unicode dec": "11212", "Unicode hex": "2BCC" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "247", "Dingbat hex": "F7", "Unicode dec": "11213", "Unicode hex": "2BCD" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "248", "Dingbat hex": "F8", "Unicode dec": "8251", "Unicode hex": "203B" },
    { "Typeface name": "Wingdings 2", "Dingbat dec": "249", "Dingbat hex": "F9", "Unicode dec": "8258", "Unicode hex": "2042" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "32", "Dingbat hex": "20", "Unicode dec": "32", "Unicode hex": "20" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "33", "Dingbat hex": "21", "Unicode dec": "11104", "Unicode hex": "2B60" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "34", "Dingbat hex": "22", "Unicode dec": "11106", "Unicode hex": "2B62" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "35", "Dingbat hex": "23", "Unicode dec": "11105", "Unicode hex": "2B61" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "36", "Dingbat hex": "24", "Unicode dec": "11107", "Unicode hex": "2B63" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "37", "Dingbat hex": "25", "Unicode dec": "11110", "Unicode hex": "2B66" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "38", "Dingbat hex": "26", "Unicode dec": "11111", "Unicode hex": "2B67" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "39", "Dingbat hex": "27", "Unicode dec": "11113", "Unicode hex": "2B69" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "40", "Dingbat hex": "28", "Unicode dec": "11112", "Unicode hex": "2B68" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "41", "Dingbat hex": "29", "Unicode dec": "11120", "Unicode hex": "2B70" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "42", "Dingbat hex": "2A", "Unicode dec": "11122", "Unicode hex": "2B72" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "43", "Dingbat hex": "2B", "Unicode dec": "11121", "Unicode hex": "2B71" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "44", "Dingbat hex": "2C", "Unicode dec": "11123", "Unicode hex": "2B73" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "45", "Dingbat hex": "2D", "Unicode dec": "11126", "Unicode hex": "2B76" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "46", "Dingbat hex": "2E", "Unicode dec": "11128", "Unicode hex": "2B78" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "47", "Dingbat hex": "2F", "Unicode dec": "11131", "Unicode hex": "2B7B" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "48", "Dingbat hex": "30", "Unicode dec": "11133", "Unicode hex": "2B7D" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "49", "Dingbat hex": "31", "Unicode dec": "11108", "Unicode hex": "2B64" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "50", "Dingbat hex": "32", "Unicode dec": "11109", "Unicode hex": "2B65" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "51", "Dingbat hex": "33", "Unicode dec": "11114", "Unicode hex": "2B6A" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "52", "Dingbat hex": "34", "Unicode dec": "11116", "Unicode hex": "2B6C" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "53", "Dingbat hex": "35", "Unicode dec": "11115", "Unicode hex": "2B6B" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "54", "Dingbat hex": "36", "Unicode dec": "11117", "Unicode hex": "2B6D" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "55", "Dingbat hex": "37", "Unicode dec": "11085", "Unicode hex": "2B4D" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "56", "Dingbat hex": "38", "Unicode dec": "11168", "Unicode hex": "2BA0" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "57", "Dingbat hex": "39", "Unicode dec": "11169", "Unicode hex": "2BA1" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "58", "Dingbat hex": "3A", "Unicode dec": "11170", "Unicode hex": "2BA2" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "59", "Dingbat hex": "3B", "Unicode dec": "11171", "Unicode hex": "2BA3" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "60", "Dingbat hex": "3C", "Unicode dec": "11172", "Unicode hex": "2BA4" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "61", "Dingbat hex": "3D", "Unicode dec": "11173", "Unicode hex": "2BA5" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "62", "Dingbat hex": "3E", "Unicode dec": "11174", "Unicode hex": "2BA6" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "63", "Dingbat hex": "3F", "Unicode dec": "11175", "Unicode hex": "2BA7" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "64", "Dingbat hex": "40", "Unicode dec": "11152", "Unicode hex": "2B90" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "65", "Dingbat hex": "41", "Unicode dec": "11153", "Unicode hex": "2B91" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "66", "Dingbat hex": "42", "Unicode dec": "11154", "Unicode hex": "2B92" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "67", "Dingbat hex": "43", "Unicode dec": "11155", "Unicode hex": "2B93" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "68", "Dingbat hex": "44", "Unicode dec": "11136", "Unicode hex": "2B80" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "69", "Dingbat hex": "45", "Unicode dec": "11139", "Unicode hex": "2B83" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "70", "Dingbat hex": "46", "Unicode dec": "11134", "Unicode hex": "2B7E" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "71", "Dingbat hex": "47", "Unicode dec": "11135", "Unicode hex": "2B7F" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "72", "Dingbat hex": "48", "Unicode dec": "11140", "Unicode hex": "2B84" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "73", "Dingbat hex": "49", "Unicode dec": "11142", "Unicode hex": "2B86" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "74", "Dingbat hex": "4A", "Unicode dec": "11141", "Unicode hex": "2B85" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "75", "Dingbat hex": "4B", "Unicode dec": "11143", "Unicode hex": "2B87" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "76", "Dingbat hex": "4C", "Unicode dec": "11151", "Unicode hex": "2B8F" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "77", "Dingbat hex": "4D", "Unicode dec": "11149", "Unicode hex": "2B8D" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "78", "Dingbat hex": "4E", "Unicode dec": "11150", "Unicode hex": "2B8E" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "79", "Dingbat hex": "4F", "Unicode dec": "11148", "Unicode hex": "2B8C" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "80", "Dingbat hex": "50", "Unicode dec": "11118", "Unicode hex": "2B6E" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "81", "Dingbat hex": "51", "Unicode dec": "11119", "Unicode hex": "2B6F" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "82", "Dingbat hex": "52", "Unicode dec": "9099", "Unicode hex": "238B" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "83", "Dingbat hex": "53", "Unicode dec": "8996", "Unicode hex": "2324" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "84", "Dingbat hex": "54", "Unicode dec": "8963", "Unicode hex": "2303" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "85", "Dingbat hex": "55", "Unicode dec": "8997", "Unicode hex": "2325" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "86", "Dingbat hex": "56", "Unicode dec": "9251", "Unicode hex": "2423" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "87", "Dingbat hex": "57", "Unicode dec": "9085", "Unicode hex": "237D" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "88", "Dingbat hex": "58", "Unicode dec": "8682", "Unicode hex": "21EA" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "89", "Dingbat hex": "59", "Unicode dec": "11192", "Unicode hex": "2BB8" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "90", "Dingbat hex": "5A", "Unicode dec": "129184", "Unicode hex": "1F8A0" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "91", "Dingbat hex": "5B", "Unicode dec": "129185", "Unicode hex": "1F8A1" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "92", "Dingbat hex": "5C", "Unicode dec": "129186", "Unicode hex": "1F8A2" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "93", "Dingbat hex": "5D", "Unicode dec": "129187", "Unicode hex": "1F8A3" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "94", "Dingbat hex": "5E", "Unicode dec": "129188", "Unicode hex": "1F8A4" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "95", "Dingbat hex": "5F", "Unicode dec": "129189", "Unicode hex": "1F8A5" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "96", "Dingbat hex": "60", "Unicode dec": "129190", "Unicode hex": "1F8A6" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "97", "Dingbat hex": "61", "Unicode dec": "129191", "Unicode hex": "1F8A7" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "98", "Dingbat hex": "62", "Unicode dec": "129192", "Unicode hex": "1F8A8" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "99", "Dingbat hex": "63", "Unicode dec": "129193", "Unicode hex": "1F8A9" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "100", "Dingbat hex": "64", "Unicode dec": "129194", "Unicode hex": "1F8AA" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "101", "Dingbat hex": "65", "Unicode dec": "129195", "Unicode hex": "1F8AB" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "102", "Dingbat hex": "66", "Unicode dec": "129104", "Unicode hex": "1F850" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "103", "Dingbat hex": "67", "Unicode dec": "129106", "Unicode hex": "1F852" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "104", "Dingbat hex": "68", "Unicode dec": "129105", "Unicode hex": "1F851" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "105", "Dingbat hex": "69", "Unicode dec": "129107", "Unicode hex": "1F853" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "106", "Dingbat hex": "6A", "Unicode dec": "129108", "Unicode hex": "1F854" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "107", "Dingbat hex": "6B", "Unicode dec": "129109", "Unicode hex": "1F855" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "108", "Dingbat hex": "6C", "Unicode dec": "129111", "Unicode hex": "1F857" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "109", "Dingbat hex": "6D", "Unicode dec": "129110", "Unicode hex": "1F856" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "110", "Dingbat hex": "6E", "Unicode dec": "129112", "Unicode hex": "1F858" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "111", "Dingbat hex": "6F", "Unicode dec": "129113", "Unicode hex": "1F859" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "112", "Dingbat hex": "70", "Unicode dec": "9650", "Unicode hex": "25B2" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "113", "Dingbat hex": "71", "Unicode dec": "9660", "Unicode hex": "25BC" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "114", "Dingbat hex": "72", "Unicode dec": "9651", "Unicode hex": "25B3" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "115", "Dingbat hex": "73", "Unicode dec": "9661", "Unicode hex": "25BD" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "116", "Dingbat hex": "74", "Unicode dec": "9664", "Unicode hex": "25C0" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "117", "Dingbat hex": "75", "Unicode dec": "9654", "Unicode hex": "25B6" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "118", "Dingbat hex": "76", "Unicode dec": "9665", "Unicode hex": "25C1" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "119", "Dingbat hex": "77", "Unicode dec": "9655", "Unicode hex": "25B7" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "120", "Dingbat hex": "78", "Unicode dec": "9699", "Unicode hex": "25E3" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "121", "Dingbat hex": "79", "Unicode dec": "9698", "Unicode hex": "25E2" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "122", "Dingbat hex": "7A", "Unicode dec": "9700", "Unicode hex": "25E4" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "123", "Dingbat hex": "7B", "Unicode dec": "9701", "Unicode hex": "25E5" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "124", "Dingbat hex": "7C", "Unicode dec": "128896", "Unicode hex": "1F780" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "125", "Dingbat hex": "7D", "Unicode dec": "128898", "Unicode hex": "1F782" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "126", "Dingbat hex": "7E", "Unicode dec": "128897", "Unicode hex": "1F781" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "128", "Dingbat hex": "80", "Unicode dec": "128899", "Unicode hex": "1F783" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "129", "Dingbat hex": "81", "Unicode dec": "11205", "Unicode hex": "2BC5" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "130", "Dingbat hex": "82", "Unicode dec": "11206", "Unicode hex": "2BC6" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "131", "Dingbat hex": "83", "Unicode dec": "11207", "Unicode hex": "2BC7" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "132", "Dingbat hex": "84", "Unicode dec": "11208", "Unicode hex": "2BC8" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "133", "Dingbat hex": "85", "Unicode dec": "11164", "Unicode hex": "2B9C" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "134", "Dingbat hex": "86", "Unicode dec": "11166", "Unicode hex": "2B9E" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "135", "Dingbat hex": "87", "Unicode dec": "11165", "Unicode hex": "2B9D" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "136", "Dingbat hex": "88", "Unicode dec": "11167", "Unicode hex": "2B9F" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "137", "Dingbat hex": "89", "Unicode dec": "129040", "Unicode hex": "1F810" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "138", "Dingbat hex": "8A", "Unicode dec": "129042", "Unicode hex": "1F812" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "139", "Dingbat hex": "8B", "Unicode dec": "129041", "Unicode hex": "1F811" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "140", "Dingbat hex": "8C", "Unicode dec": "129043", "Unicode hex": "1F813" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "141", "Dingbat hex": "8D", "Unicode dec": "129044", "Unicode hex": "1F814" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "142", "Dingbat hex": "8E", "Unicode dec": "129046", "Unicode hex": "1F816" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "143", "Dingbat hex": "8F", "Unicode dec": "129045", "Unicode hex": "1F815" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "144", "Dingbat hex": "90", "Unicode dec": "129047", "Unicode hex": "1F817" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "145", "Dingbat hex": "91", "Unicode dec": "129048", "Unicode hex": "1F818" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "146", "Dingbat hex": "92", "Unicode dec": "129050", "Unicode hex": "1F81A" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "147", "Dingbat hex": "93", "Unicode dec": "129049", "Unicode hex": "1F819" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "148", "Dingbat hex": "94", "Unicode dec": "129051", "Unicode hex": "1F81B" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "149", "Dingbat hex": "95", "Unicode dec": "129052", "Unicode hex": "1F81C" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "150", "Dingbat hex": "96", "Unicode dec": "129054", "Unicode hex": "1F81E" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "151", "Dingbat hex": "97", "Unicode dec": "129053", "Unicode hex": "1F81D" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "152", "Dingbat hex": "98", "Unicode dec": "129055", "Unicode hex": "1F81F" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "153", "Dingbat hex": "99", "Unicode dec": "129024", "Unicode hex": "1F800" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "154", "Dingbat hex": "9A", "Unicode dec": "129026", "Unicode hex": "1F802" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "155", "Dingbat hex": "9B", "Unicode dec": "129025", "Unicode hex": "1F801" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "156", "Dingbat hex": "9C", "Unicode dec": "129027", "Unicode hex": "1F803" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "157", "Dingbat hex": "9D", "Unicode dec": "129028", "Unicode hex": "1F804" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "158", "Dingbat hex": "9E", "Unicode dec": "129030", "Unicode hex": "1F806" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "159", "Dingbat hex": "9F", "Unicode dec": "129029", "Unicode hex": "1F805" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "160", "Dingbat hex": "A0", "Unicode dec": "129031", "Unicode hex": "1F807" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "161", "Dingbat hex": "A1", "Unicode dec": "129032", "Unicode hex": "1F808" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "162", "Dingbat hex": "A2", "Unicode dec": "129034", "Unicode hex": "1F80A" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "163", "Dingbat hex": "A3", "Unicode dec": "129033", "Unicode hex": "1F809" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "164", "Dingbat hex": "A4", "Unicode dec": "129035", "Unicode hex": "1F80B" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "165", "Dingbat hex": "A5", "Unicode dec": "129056", "Unicode hex": "1F820" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "166", "Dingbat hex": "A6", "Unicode dec": "129058", "Unicode hex": "1F822" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "167", "Dingbat hex": "A7", "Unicode dec": "129060", "Unicode hex": "1F824" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "168", "Dingbat hex": "A8", "Unicode dec": "129062", "Unicode hex": "1F826" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "169", "Dingbat hex": "A9", "Unicode dec": "129064", "Unicode hex": "1F828" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "170", "Dingbat hex": "AA", "Unicode dec": "129066", "Unicode hex": "1F82A" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "171", "Dingbat hex": "AB", "Unicode dec": "129068", "Unicode hex": "1F82C" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "172", "Dingbat hex": "AC", "Unicode dec": "129180", "Unicode hex": "1F89C" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "173", "Dingbat hex": "AD", "Unicode dec": "129181", "Unicode hex": "1F89D" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "174", "Dingbat hex": "AE", "Unicode dec": "129182", "Unicode hex": "1F89E" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "175", "Dingbat hex": "AF", "Unicode dec": "129183", "Unicode hex": "1F89F" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "176", "Dingbat hex": "B0", "Unicode dec": "129070", "Unicode hex": "1F82E" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "177", "Dingbat hex": "B1", "Unicode dec": "129072", "Unicode hex": "1F830" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "178", "Dingbat hex": "B2", "Unicode dec": "129074", "Unicode hex": "1F832" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "179", "Dingbat hex": "B3", "Unicode dec": "129076", "Unicode hex": "1F834" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "180", "Dingbat hex": "B4", "Unicode dec": "129078", "Unicode hex": "1F836" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "181", "Dingbat hex": "B5", "Unicode dec": "129080", "Unicode hex": "1F838" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "182", "Dingbat hex": "B6", "Unicode dec": "129082", "Unicode hex": "1F83A" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "183", "Dingbat hex": "B7", "Unicode dec": "129081", "Unicode hex": "1F839" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "184", "Dingbat hex": "B8", "Unicode dec": "129083", "Unicode hex": "1F83B" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "185", "Dingbat hex": "B9", "Unicode dec": "129176", "Unicode hex": "1F898" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "186", "Dingbat hex": "BA", "Unicode dec": "129178", "Unicode hex": "1F89A" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "187", "Dingbat hex": "BB", "Unicode dec": "129177", "Unicode hex": "1F899" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "188", "Dingbat hex": "BC", "Unicode dec": "129179", "Unicode hex": "1F89B" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "189", "Dingbat hex": "BD", "Unicode dec": "129084", "Unicode hex": "1F83C" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "190", "Dingbat hex": "BE", "Unicode dec": "129086", "Unicode hex": "1F83E" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "191", "Dingbat hex": "BF", "Unicode dec": "129085", "Unicode hex": "1F83D" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "192", "Dingbat hex": "C0", "Unicode dec": "129087", "Unicode hex": "1F83F" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "193", "Dingbat hex": "C1", "Unicode dec": "129088", "Unicode hex": "1F840" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "194", "Dingbat hex": "C2", "Unicode dec": "129090", "Unicode hex": "1F842" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "195", "Dingbat hex": "C3", "Unicode dec": "129089", "Unicode hex": "1F841" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "196", "Dingbat hex": "C4", "Unicode dec": "129091", "Unicode hex": "1F843" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "197", "Dingbat hex": "C5", "Unicode dec": "129092", "Unicode hex": "1F844" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "198", "Dingbat hex": "C6", "Unicode dec": "129094", "Unicode hex": "1F846" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "199", "Dingbat hex": "C7", "Unicode dec": "129093", "Unicode hex": "1F845" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "200", "Dingbat hex": "C8", "Unicode dec": "129095", "Unicode hex": "1F847" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "201", "Dingbat hex": "C9", "Unicode dec": "11176", "Unicode hex": "2BA8" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "202", "Dingbat hex": "CA", "Unicode dec": "11177", "Unicode hex": "2BA9" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "203", "Dingbat hex": "CB", "Unicode dec": "11178", "Unicode hex": "2BAA" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "204", "Dingbat hex": "CC", "Unicode dec": "11179", "Unicode hex": "2BAB" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "205", "Dingbat hex": "CD", "Unicode dec": "11180", "Unicode hex": "2BAC" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "206", "Dingbat hex": "CE", "Unicode dec": "11181", "Unicode hex": "2BAD" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "207", "Dingbat hex": "CF", "Unicode dec": "11182", "Unicode hex": "2BAE" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "208", "Dingbat hex": "D0", "Unicode dec": "11183", "Unicode hex": "2BAF" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "209", "Dingbat hex": "D1", "Unicode dec": "129120", "Unicode hex": "1F860" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "210", "Dingbat hex": "D2", "Unicode dec": "129122", "Unicode hex": "1F862" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "211", "Dingbat hex": "D3", "Unicode dec": "129121", "Unicode hex": "1F861" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "212", "Dingbat hex": "D4", "Unicode dec": "129123", "Unicode hex": "1F863" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "213", "Dingbat hex": "D5", "Unicode dec": "129124", "Unicode hex": "1F864" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "214", "Dingbat hex": "D6", "Unicode dec": "129125", "Unicode hex": "1F865" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "215", "Dingbat hex": "D7", "Unicode dec": "129127", "Unicode hex": "1F867" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "216", "Dingbat hex": "D8", "Unicode dec": "129126", "Unicode hex": "1F866" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "217", "Dingbat hex": "D9", "Unicode dec": "129136", "Unicode hex": "1F870" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "218", "Dingbat hex": "DA", "Unicode dec": "129138", "Unicode hex": "1F872" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "219", "Dingbat hex": "DB", "Unicode dec": "129137", "Unicode hex": "1F871" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "220", "Dingbat hex": "DC", "Unicode dec": "129139", "Unicode hex": "1F873" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "221", "Dingbat hex": "DD", "Unicode dec": "129140", "Unicode hex": "1F874" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "222", "Dingbat hex": "DE", "Unicode dec": "129141", "Unicode hex": "1F875" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "223", "Dingbat hex": "DF", "Unicode dec": "129143", "Unicode hex": "1F877" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "224", "Dingbat hex": "E0", "Unicode dec": "129142", "Unicode hex": "1F876" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "225", "Dingbat hex": "E1", "Unicode dec": "129152", "Unicode hex": "1F880" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "226", "Dingbat hex": "E2", "Unicode dec": "129154", "Unicode hex": "1F882" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "227", "Dingbat hex": "E3", "Unicode dec": "129153", "Unicode hex": "1F881" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "228", "Dingbat hex": "E4", "Unicode dec": "129155", "Unicode hex": "1F883" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "229", "Dingbat hex": "E5", "Unicode dec": "129156", "Unicode hex": "1F884" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "230", "Dingbat hex": "E6", "Unicode dec": "129157", "Unicode hex": "1F885" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "231", "Dingbat hex": "E7", "Unicode dec": "129159", "Unicode hex": "1F887" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "232", "Dingbat hex": "E8", "Unicode dec": "129158", "Unicode hex": "1F886" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "233", "Dingbat hex": "E9", "Unicode dec": "129168", "Unicode hex": "1F890" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "234", "Dingbat hex": "EA", "Unicode dec": "129170", "Unicode hex": "1F892" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "235", "Dingbat hex": "EB", "Unicode dec": "129169", "Unicode hex": "1F891" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "236", "Dingbat hex": "EC", "Unicode dec": "129171", "Unicode hex": "1F893" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "237", "Dingbat hex": "ED", "Unicode dec": "129172", "Unicode hex": "1F894" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "238", "Dingbat hex": "EE", "Unicode dec": "129174", "Unicode hex": "1F896" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "239", "Dingbat hex": "EF", "Unicode dec": "129173", "Unicode hex": "1F895" },
    { "Typeface name": "Wingdings 3", "Dingbat dec": "240", "Dingbat hex": "F0", "Unicode dec": "129175", "Unicode hex": "1F897" },
];
exports["default"] = dingbats;


/***/ }),

/***/ 97673:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

"use strict";

var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", ({ value: true }));
exports.hex = exports.dec = exports.codePoint = void 0;
var dingbats_1 = __importDefault(__webpack_require__(27945));
var dingbatsByCodePoint = {};
var fromCodePoint = String.fromCodePoint ? String.fromCodePoint : fromCodePointPolyfill;
for (var _i = 0, dingbats_2 = dingbats_1.default; _i < dingbats_2.length; _i++) {
    var dingbat = dingbats_2[_i];
    var codePoint_1 = parseInt(dingbat["Unicode dec"], 10);
    var scalarValue = {
        codePoint: codePoint_1,
        string: fromCodePoint(codePoint_1),
    };
    dingbatsByCodePoint[dingbat["Typeface name"].toUpperCase() + "_" + dingbat["Dingbat dec"]] = scalarValue;
}
function codePoint(typeface, codePoint) {
    return dingbatsByCodePoint[typeface.toUpperCase() + "_" + codePoint];
}
exports.codePoint = codePoint;
function dec(typeface, dec) {
    return codePoint(typeface, parseInt(dec, 10));
}
exports.dec = dec;
function hex(typeface, hex) {
    return codePoint(typeface, parseInt(hex, 16));
}
exports.hex = hex;
function fromCodePointPolyfill(codePoint) {
    if (codePoint <= 0xFFFF) {
        // BMP
        return String.fromCharCode(codePoint);
    }
    else {
        // Astral
        // https://mathiasbynens.be/notes/javascript-encoding#surrogate-formulae
        var highSurrogate = Math.floor((codePoint - 0x10000) / 0x400) + 0xD800;
        var lowSurrogate = (codePoint - 0x10000) % 0x400 + 0xDC00;
        return String.fromCharCode(highSurrogate, lowSurrogate);
    }
}
;


/***/ }),

/***/ 96324:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

exports.Parser = __webpack_require__(50405).Parser;
exports.rules = __webpack_require__(38815);
exports.errors = __webpack_require__(73649);
exports.results = __webpack_require__(40315);
exports.StringSource = __webpack_require__(30894);
exports.Token = __webpack_require__(92013);
exports.bottomUp = __webpack_require__(30351);
exports.RegexTokeniser = __webpack_require__(56192).RegexTokeniser;

exports.rule = function(ruleBuilder) {
    var rule;
    return function(input) {
        if (!rule) {
            rule = ruleBuilder();
        }
        return rule(input);
    };
};


/***/ }),

/***/ 30894:
/***/ (function(module) {

var StringSource = module.exports = function(string, description) {
    var self = {
        asString: function() {
            return string;
        },
        range: function(startIndex, endIndex) {
            return new StringSourceRange(string, description, startIndex, endIndex);
        }
    };
    return self;
};

var StringSourceRange = function(string, description, startIndex, endIndex) {
    this._string = string;
    this._description = description;
    this._startIndex = startIndex;
    this._endIndex = endIndex;
};

StringSourceRange.prototype.to = function(otherRange) {
    // TODO: Assert that tokens are the same across both iterators
    return new StringSourceRange(this._string, this._description, this._startIndex, otherRange._endIndex);
};

StringSourceRange.prototype.describe = function() {
    var position = this._position();
    var description = this._description ? this._description + "\n" : "";
    return description + "Line number: " + position.lineNumber + "\nCharacter number: " + position.characterNumber;
};

StringSourceRange.prototype.lineNumber = function() {
    return this._position().lineNumber;
};

StringSourceRange.prototype.characterNumber = function() {
    return this._position().characterNumber;
};

StringSourceRange.prototype._position = function() {
    var self = this;
    var index = 0;
    var nextNewLine = function() {
        return self._string.indexOf("\n", index);
    };

    var lineNumber = 1;
    while (nextNewLine() !== -1 && nextNewLine() < this._startIndex) {
        index = nextNewLine() + 1;
        lineNumber += 1;
    }
    var characterNumber = this._startIndex - index + 1;
    return {lineNumber: lineNumber, characterNumber: characterNumber};
};


/***/ }),

/***/ 92013:
/***/ (function(module) {

module.exports = function(name, value, source) {
    this.name = name;
    this.value = value;
    if (source) {
        this.source = source;
    }
};


/***/ }),

/***/ 63999:
/***/ (function(module) {

var TokenIterator = module.exports = function(tokens, startIndex) {
    this._tokens = tokens;
    this._startIndex = startIndex || 0;
};

TokenIterator.prototype.head = function() {
    return this._tokens[this._startIndex];
};

TokenIterator.prototype.tail = function(startIndex) {
    return new TokenIterator(this._tokens, this._startIndex + 1);
};

TokenIterator.prototype.toArray = function() {
    return this._tokens.slice(this._startIndex);
};

TokenIterator.prototype.end = function() {
    return this._tokens[this._tokens.length - 1];
};

// TODO: doesn't need to be a method, can be a separate function,
// which simplifies implementation of the TokenIterator interface
TokenIterator.prototype.to = function(end) {
    var start = this.head().source;
    var endToken = end.head() || end.end();
    return start.to(endToken.source);
};


/***/ }),

/***/ 30351:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var rules = __webpack_require__(38815);
var results = __webpack_require__(40315);

exports.parser = function(name, prefixRules, infixRuleBuilders) {
    var self = {
        rule: rule,
        leftAssociative: leftAssociative,
        rightAssociative: rightAssociative
    };
    
    var infixRules = new InfixRules(infixRuleBuilders.map(createInfixRule));
    var prefixRule = rules.firstOf(name, prefixRules);
    
    function createInfixRule(infixRuleBuilder) {
        return {
            name: infixRuleBuilder.name,
            rule: lazyRule(infixRuleBuilder.ruleBuilder.bind(null, self))
        };
    }
    
    function rule() {
        return createRule(infixRules);
    }
    
    function leftAssociative(name) {
        return createRule(infixRules.untilExclusive(name));
    }
    
    function rightAssociative(name) {
        return createRule(infixRules.untilInclusive(name));
    }
    
    function createRule(infixRules) {
        return apply.bind(null, infixRules);
    }
    
    function apply(infixRules, tokens) {
        var leftResult = prefixRule(tokens);
        if (leftResult.isSuccess()) {
            return infixRules.apply(leftResult);
        } else {
            return leftResult;
        }
    }
    
    return self;
};

function InfixRules(infixRules) {
    function untilExclusive(name) {
        return new InfixRules(infixRules.slice(0, ruleNames().indexOf(name)));
    }
    
    function untilInclusive(name) {
        return new InfixRules(infixRules.slice(0, ruleNames().indexOf(name) + 1));
    }
    
    function ruleNames() {
        return infixRules.map(function(rule) {
            return rule.name;
        });
    }
    
    function apply(leftResult) {
        var currentResult;
        var source;
        while (true) {
            currentResult = applyToTokens(leftResult.remaining());
            if (currentResult.isSuccess()) {
                source = leftResult.source().to(currentResult.source());
                leftResult = results.success(
                    currentResult.value()(leftResult.value(), source),
                    currentResult.remaining(),
                    source
                )
            } else if (currentResult.isFailure()) {
                return leftResult;
            } else {
                return currentResult;
            }
        }
    }
    
    function applyToTokens(tokens) {
        return rules.firstOf("infix", infixRules.map(function(infix) {
            return infix.rule;
        }))(tokens);
    }
    
    return {
        apply: apply,
        untilExclusive: untilExclusive,
        untilInclusive: untilInclusive
    }
}

exports.infix = function(name, ruleBuilder) {
    function map(func) {
        return exports.infix(name, function(parser) {
            var rule = ruleBuilder(parser);
            return function(tokens) {
                var result = rule(tokens);
                return result.map(function(right) {
                    return function(left, source) {
                        return func(left, right, source);
                    };
                });
            };
        });
    }
    
    return {
        name: name,
        ruleBuilder: ruleBuilder,
        map: map
    };
}

// TODO: move into a sensible place and remove duplication
var lazyRule = function(ruleBuilder) {
    var rule;
    return function(input) {
        if (!rule) {
            rule = ruleBuilder();
        }
        return rule(input);
    };
};


/***/ }),

/***/ 73649:
/***/ (function(__unused_webpack_module, exports) {

exports.error = function(options) {
    return new Error(options);
};

var Error = function(options) {
    this.expected = options.expected;
    this.actual = options.actual;
    this._location = options.location;
};

Error.prototype.describe = function() {
    var locationDescription = this._location ? this._location.describe() + ":\n" : "";
    return locationDescription + "Expected " + this.expected + "\nbut got " + this.actual;
};

Error.prototype.lineNumber = function() {
    return this._location.lineNumber();
};

Error.prototype.characterNumber = function() {
    return this._location.characterNumber();
};


/***/ }),

/***/ 45758:
/***/ (function(__unused_webpack_module, exports) {

var fromArray = exports.fromArray = function(array) {
    var index = 0;
    var hasNext = function() {
        return index < array.length;
    };
    return new LazyIterator({
        hasNext: hasNext,
        next: function() {
            if (!hasNext()) {
                throw new Error("No more elements");
            } else {
                return array[index++];
            }
        }
    });
};

var LazyIterator = function(iterator) {
    this._iterator = iterator;
};

LazyIterator.prototype.map = function(func) {
    var iterator = this._iterator;
    return new LazyIterator({
        hasNext: function() {
            return iterator.hasNext();
        },
        next: function() {
            return func(iterator.next());
        }
    });
};

LazyIterator.prototype.filter = function(condition) {
    var iterator = this._iterator;
    
    var moved = false;
    var hasNext = false;
    var next;
    var moveIfNecessary = function() {
        if (moved) {
            return;
        }
        moved = true;
        hasNext = false;
        while (iterator.hasNext() && !hasNext) {
            next = iterator.next();
            hasNext = condition(next);
        }
    };
    
    return new LazyIterator({
        hasNext: function() {
            moveIfNecessary();
            return hasNext;
        },
        next: function() {
            moveIfNecessary();
            var toReturn = next;
            moved = false;
            return toReturn;
        }
    });
};

LazyIterator.prototype.first = function() {
    var iterator = this._iterator;
    if (this._iterator.hasNext()) {
        return iterator.next();
    } else {
        return null;
    }
};

LazyIterator.prototype.toArray = function() {
    var result = [];
    while (this._iterator.hasNext()) {
        result.push(this._iterator.next());
    }
    return result;
};


/***/ }),

/***/ 50405:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var TokenIterator = __webpack_require__(63999);

exports.Parser = function(options) {
    var parseTokens = function(parser, tokens) {
        return parser(new TokenIterator(tokens));
    };
    
    return {
        parseTokens: parseTokens
    };
};


/***/ }),

/***/ 40315:
/***/ (function(module) {

module.exports = {
    failure: function(errors, remaining) {
        if (errors.length < 1) {
            throw new Error("Failure must have errors");
        }
        return new Result({
            status: "failure",
            remaining: remaining,
            errors: errors
        });
    },
    error: function(errors, remaining) {
        if (errors.length < 1) {
            throw new Error("Failure must have errors");
        }
        return new Result({
            status: "error",
            remaining: remaining,
            errors: errors
        });
    },
    success: function(value, remaining, source) {
        return new Result({
            status: "success",
            value: value,
            source: source,
            remaining: remaining,
            errors: []
        });
    },
    cut: function(remaining) {
        return new Result({
            status: "cut",
            remaining: remaining,
            errors: []
        });
    }
};

var Result = function(options) {
    this._value = options.value;
    this._status = options.status;
    this._hasValue = options.value !== undefined;
    this._remaining = options.remaining;
    this._source = options.source;
    this._errors = options.errors;
};

Result.prototype.map = function(func) {
    if (this._hasValue) {
        return new Result({
            value: func(this._value, this._source),
            status: this._status,
            remaining: this._remaining,
            source: this._source,
            errors: this._errors
        });
    } else {
        return this;
    }
};

Result.prototype.changeRemaining = function(remaining) {
    return new Result({
        value: this._value,
        status: this._status,
        remaining: remaining,
        source: this._source,
        errors: this._errors
    });
};

Result.prototype.isSuccess = function() {
    return this._status === "success" || this._status === "cut";
};

Result.prototype.isFailure = function() {
    return this._status === "failure";
};

Result.prototype.isError = function() {
    return this._status === "error";
};

Result.prototype.isCut = function() {
    return this._status === "cut";
};

Result.prototype.value = function() {
    return this._value;
};

Result.prototype.remaining = function() {
    return this._remaining;
};

Result.prototype.source = function() {
    return this._source;
};

Result.prototype.errors = function() {
    return this._errors;
};


/***/ }),

/***/ 56192:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var Token = __webpack_require__(92013);
var StringSource = __webpack_require__(30894);

exports.RegexTokeniser = RegexTokeniser;

function RegexTokeniser(rules) {
    rules = rules.map(function(rule) {
        return {
            name: rule.name,
            regex: new RegExp(rule.regex.source, "g")
        };
    });
    
    function tokenise(input, description) {
        var source = new StringSource(input, description);
        var index = 0;
        var tokens = [];
    
        while (index < input.length) {
            var result = readNextToken(input, index, source);
            index = result.endIndex;
            tokens.push(result.token);
        }
        
        tokens.push(endToken(input, source));
        return tokens;
    }

    function readNextToken(string, startIndex, source) {
        for (var i = 0; i < rules.length; i++) {
            var regex = rules[i].regex;
            regex.lastIndex = startIndex;
            var result = regex.exec(string);
            
            if (result) {
                var endIndex = startIndex + result[0].length;
                if (result.index === startIndex && endIndex > startIndex) {
                    var value = result[1];
                    var token = new Token(
                        rules[i].name,
                        value,
                        source.range(startIndex, endIndex)
                    );
                    return {token: token, endIndex: endIndex};
                }
            }
        }
        var endIndex = startIndex + 1;
        var token = new Token(
            "unrecognisedCharacter",
            string.substring(startIndex, endIndex),
            source.range(startIndex, endIndex)
        );
        return {token: token, endIndex: endIndex};
    }
    
    function endToken(input, source) {
        return new Token(
            "end",
            null,
            source.range(input.length, input.length)
        );
    }
    
    return {
        tokenise: tokenise
    }
}




/***/ }),

/***/ 38815:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);
var options = __webpack_require__(19228);
var results = __webpack_require__(40315);
var errors = __webpack_require__(73649);
var lazyIterators = __webpack_require__(45758);

exports.token = function(tokenType, value) {
    var matchValue = value !== undefined;
    return function(input) {
        var token = input.head();
        if (token && token.name === tokenType && (!matchValue || token.value === value)) {
            return results.success(token.value, input.tail(), token.source);
        } else {
            var expected = describeToken({name: tokenType, value: value});
            return describeTokenMismatch(input, expected);
        }
    };
};

exports.tokenOfType = function(tokenType) {
    return exports.token(tokenType);
};

exports.firstOf = function(name, parsers) {
    if (!_.isArray(parsers)) {
        parsers = Array.prototype.slice.call(arguments, 1);
    }
    return function(input) {
        return lazyIterators
            .fromArray(parsers)
            .map(function(parser) {
                return parser(input);
            })
            .filter(function(result) {
                return result.isSuccess() || result.isError();
            })
            .first() || describeTokenMismatch(input, name);
    };
};

exports.then = function(parser, func) {
    return function(input) {
        var result = parser(input);
        if (!result.map) {
            console.log(result);
        }
        return result.map(func);
    };
};

exports.sequence = function() {
    var parsers = Array.prototype.slice.call(arguments, 0);
    var rule = function(input) {
        var result = _.foldl(parsers, function(memo, parser) {
            var result = memo.result;
            var hasCut = memo.hasCut;
            if (!result.isSuccess()) {
                return {result: result, hasCut: hasCut};
            }
            var subResult = parser(result.remaining());
            if (subResult.isCut()) {
                return {result: result, hasCut: true};
            } else if (subResult.isSuccess()) {
                var values;
                if (parser.isCaptured) {
                    values = result.value().withValue(parser, subResult.value());
                } else {
                    values = result.value();
                }
                var remaining = subResult.remaining();
                var source = input.to(remaining);
                return {
                    result: results.success(values, remaining, source),
                    hasCut: hasCut
                };
            } else if (hasCut) {
                return {result: results.error(subResult.errors(), subResult.remaining()), hasCut: hasCut};
            } else {
                return {result: subResult, hasCut: hasCut};
            }
        }, {result: results.success(new SequenceValues(), input), hasCut: false}).result;
        var source = input.to(result.remaining());
        return result.map(function(values) {
            return values.withValue(exports.sequence.source, source);
        });
    };
    rule.head = function() {
        var firstCapture = _.find(parsers, isCapturedRule);
        return exports.then(
            rule,
            exports.sequence.extract(firstCapture)
        );
    };
    rule.map = function(func) {
        return exports.then(
            rule,
            function(result) {
                return func.apply(this, result.toArray());
            }
        );
    };
    
    function isCapturedRule(subRule) {
        return subRule.isCaptured;
    }
    
    return rule;
};

var SequenceValues = function(values, valuesArray) {
    this._values = values || {};
    this._valuesArray = valuesArray || [];
};

SequenceValues.prototype.withValue = function(rule, value) {
    if (rule.captureName && rule.captureName in this._values) {
        throw new Error("Cannot add second value for capture \"" + rule.captureName + "\"");
    } else {
        var newValues = _.clone(this._values);
        newValues[rule.captureName] = value;
        var newValuesArray = this._valuesArray.concat([value]);
        return new SequenceValues(newValues, newValuesArray);
    }
};

SequenceValues.prototype.get = function(rule) {
    if (rule.captureName in this._values) {
        return this._values[rule.captureName];
    } else {
        throw new Error("No value for capture \"" + rule.captureName + "\"");
    }
};

SequenceValues.prototype.toArray = function() {
    return this._valuesArray;
};

exports.sequence.capture = function(rule, name) {
    var captureRule = function() {
        return rule.apply(this, arguments);
    };
    captureRule.captureName = name;
    captureRule.isCaptured = true;
    return captureRule;
};

exports.sequence.extract = function(rule) {
    return function(result) {
        return result.get(rule);
    };
};

exports.sequence.applyValues = function(func) {
    // TODO: check captureName doesn't conflict with source or other captures
    var rules = Array.prototype.slice.call(arguments, 1);
    return function(result) {
        var values = rules.map(function(rule) {
            return result.get(rule);
        });
        return func.apply(this, values);
    };
};

exports.sequence.source = {
    captureName: "☃source☃"
};

exports.sequence.cut = function() {
    return function(input) {
        return results.cut(input);
    };
};

exports.optional = function(rule) {
    return function(input) {
        var result = rule(input);
        if (result.isSuccess()) {
            return result.map(options.some);
        } else if (result.isFailure()) {
            return results.success(options.none, input);
        } else {
            return result;
        }
    };
};

exports.zeroOrMoreWithSeparator = function(rule, separator) {
    return repeatedWithSeparator(rule, separator, false);
};

exports.oneOrMoreWithSeparator = function(rule, separator) {
    return repeatedWithSeparator(rule, separator, true);
};

var zeroOrMore = exports.zeroOrMore = function(rule) {
    return function(input) {
        var values = [];
        var result;
        while ((result = rule(input)) && result.isSuccess()) {
            input = result.remaining();
            values.push(result.value());
        }
        if (result.isError()) {
            return result;
        } else {
            return results.success(values, input);
        }
    };
};

exports.oneOrMore = function(rule) {
    return exports.oneOrMoreWithSeparator(rule, noOpRule);
};

function noOpRule(input) {
    return results.success(null, input);
}

var repeatedWithSeparator = function(rule, separator, isOneOrMore) {
    return function(input) {
        var result = rule(input);
        if (result.isSuccess()) {
            var mainRule = exports.sequence.capture(rule, "main");
            var remainingRule = zeroOrMore(exports.then(
                exports.sequence(separator, mainRule),
                exports.sequence.extract(mainRule)
            ));
            var remainingResult = remainingRule(result.remaining());
            return results.success([result.value()].concat(remainingResult.value()), remainingResult.remaining());
        } else if (isOneOrMore || result.isError()) {
            return result;
        } else {
            return results.success([], input);
        }
    };
};

exports.leftAssociative = function(leftRule, rightRule, func) {
    var rights;
    if (func) {
        rights = [{func: func, rule: rightRule}];
    } else {
        rights = rightRule;
    }
    rights = rights.map(function(right) {
        return exports.then(right.rule, function(rightValue) {
            return function(leftValue, source) {
                return right.func(leftValue, rightValue, source);
            };
        });
    });
    var repeatedRule = exports.firstOf.apply(null, ["rules"].concat(rights));
    
    return function(input) {
        var start = input;
        var leftResult = leftRule(input);
        if (!leftResult.isSuccess()) {
            return leftResult;
        }
        var repeatedResult = repeatedRule(leftResult.remaining());
        while (repeatedResult.isSuccess()) {
            var remaining = repeatedResult.remaining();
            var source = start.to(repeatedResult.remaining());
            var right = repeatedResult.value();
            leftResult = results.success(
                right(leftResult.value(), source),
                remaining,
                source
            );
            repeatedResult = repeatedRule(leftResult.remaining());
        }
        if (repeatedResult.isError()) {
            return repeatedResult;
        }
        return leftResult;
    };
};

exports.leftAssociative.firstOf = function() {
    return Array.prototype.slice.call(arguments, 0);
};

exports.nonConsuming = function(rule) {
    return function(input) {
        return rule(input).changeRemaining(input);
    };
};

var describeToken = function(token) {
    if (token.value) {
        return token.name + " \"" + token.value + "\"";
    } else {
        return token.name;
    }
};

function describeTokenMismatch(input, expected) {
    var error;
    var token = input.head();
    if (token) {
        error = errors.error({
            expected: expected,
            actual: describeToken(token),
            location: token.source
        });
    } else {
        error = errors.error({
            expected: expected,
            actual: "end of tokens"
        });
    }
    return results.failure([error], input);
}


/***/ }),

/***/ 61719:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var promises = __webpack_require__(45818);

exports.s = Files;


function Files() {
    function read(uri) {
        return promises.reject(new Error("could not open external image: '" + uri + "'\ncannot open linked files from a web browser"));
    }
    
    return {
        read: read
    };
}


/***/ }),

/***/ 42051:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var promises = __webpack_require__(45818);
var zipfile = __webpack_require__(27227);

exports.openZip = openZip;

function openZip(options) {
    if (options.arrayBuffer) {
        return promises.resolve(zipfile.openArrayBuffer(options.arrayBuffer));
    } else {
        return promises.reject(new Error("Could not find file in options"));
    }
}


/***/ }),

/***/ 5773:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;
var _ = __webpack_require__(4523);

var promises = __webpack_require__(45818);
var documents = __webpack_require__(56364);
var htmlPaths = __webpack_require__(72761);
var results = __webpack_require__(70376);
var images = __webpack_require__(41842);
var Html = __webpack_require__(61754);
var writers = __webpack_require__(27357);

exports.w = DocumentConverter;


function DocumentConverter(options) {
    return {
        convertToHtml: function(element) {
            var comments = _.indexBy(
                element.type === documents.types.document ? element.comments : [],
                "commentId"
            );
            var conversion = new DocumentConversion(options, comments);
            return conversion.convertToHtml(element);
        }
    };
}

function DocumentConversion(options, comments) {
    var noteNumber = 1;

    var noteReferences = [];

    var referencedComments = [];

    options = _.extend({ignoreEmptyParagraphs: true}, options);
    var idPrefix = options.idPrefix === undefined ? "" : options.idPrefix;
    var ignoreEmptyParagraphs = options.ignoreEmptyParagraphs;

    var defaultParagraphStyle = htmlPaths.topLevelElement("p");

    var styleMap = options.styleMap || [];

    function convertToHtml(document) {
        var messages = [];

        var html = elementToHtml(document, messages, {});

        var deferredNodes = [];
        walkHtml(html, function(node) {
            if (node.type === "deferred") {
                deferredNodes.push(node);
            }
        });
        var deferredValues = {};
        return promises.mapSeries(deferredNodes, function(deferred) {
            return deferred.value().then(function(value) {
                deferredValues[deferred.id] = value;
            });
        }).then(function() {
            function replaceDeferred(nodes) {
                return flatMap(nodes, function(node) {
                    if (node.type === "deferred") {
                        return deferredValues[node.id];
                    } else if (node.children) {
                        return [
                            _.extend({}, node, {
                                children: replaceDeferred(node.children)
                            })
                        ];
                    } else {
                        return [node];
                    }
                });
            }
            var writer = writers.writer({
                prettyPrint: options.prettyPrint,
                outputFormat: options.outputFormat
            });
            Html.write(writer, Html.simplify(replaceDeferred(html)));
            return new results.Result(writer.asString(), messages);
        });
    }

    function convertElements(elements, messages, options) {
        return flatMap(elements, function(element) {
            return elementToHtml(element, messages, options);
        });
    }

    function elementToHtml(element, messages, options) {
        if (!options) {
            throw new Error("options not set");
        }
        var handler = elementConverters[element.type];
        if (handler) {
            return handler(element, messages, options);
        } else {
            return [];
        }
    }

    function convertParagraph(element, messages, options) {
        return htmlPathForParagraph(element, messages).wrap(function() {
            var content = convertElements(element.children, messages, options);
            if (ignoreEmptyParagraphs) {
                return content;
            } else {
                return [Html.forceWrite].concat(content);
            }
        });
    }

    function htmlPathForParagraph(element, messages) {
        var style = findStyle(element);

        if (style) {
            return style.to;
        } else {
            if (element.styleId) {
                messages.push(unrecognisedStyleWarning("paragraph", element));
            }
            return defaultParagraphStyle;
        }
    }

    function convertRun(run, messages, options) {
        var nodes = function() {
            return convertElements(run.children, messages, options);
        };
        var paths = [];
        if (run.highlight !== null) {
            var path = findHtmlPath({type: "highlight", color: run.highlight});
            if (path) {
                paths.push(path);
            }
        }
        if (run.isSmallCaps) {
            paths.push(findHtmlPathForRunProperty("smallCaps"));
        }
        if (run.isAllCaps) {
            paths.push(findHtmlPathForRunProperty("allCaps"));
        }
        if (run.isStrikethrough) {
            paths.push(findHtmlPathForRunProperty("strikethrough", "s"));
        }
        if (run.isUnderline) {
            paths.push(findHtmlPathForRunProperty("underline"));
        }
        if (run.verticalAlignment === documents.verticalAlignment.subscript) {
            paths.push(htmlPaths.element("sub", {}, {fresh: false}));
        }
        if (run.verticalAlignment === documents.verticalAlignment.superscript) {
            paths.push(htmlPaths.element("sup", {}, {fresh: false}));
        }
        if (run.isItalic) {
            paths.push(findHtmlPathForRunProperty("italic", "em"));
        }
        if (run.isBold) {
            paths.push(findHtmlPathForRunProperty("bold", "strong"));
        }
        var stylePath = htmlPaths.empty;
        var style = findStyle(run);
        if (style) {
            stylePath = style.to;
        } else if (run.styleId) {
            messages.push(unrecognisedStyleWarning("run", run));
        }
        paths.push(stylePath);

        paths.forEach(function(path) {
            nodes = path.wrap.bind(path, nodes);
        });

        return nodes();
    }

    function findHtmlPathForRunProperty(elementType, defaultTagName) {
        var path = findHtmlPath({type: elementType});
        if (path) {
            return path;
        } else if (defaultTagName) {
            return htmlPaths.element(defaultTagName, {}, {fresh: false});
        } else {
            return htmlPaths.empty;
        }
    }

    function findHtmlPath(element, defaultPath) {
        var style = findStyle(element);
        return style ? style.to : defaultPath;
    }

    function findStyle(element) {
        for (var i = 0; i < styleMap.length; i++) {
            if (styleMap[i].from.matches(element)) {
                return styleMap[i];
            }
        }
    }

    function recoveringConvertImage(convertImage) {
        return function(image, messages) {
            return promises.attempt(function() {
                return convertImage(image, messages);
            }).caught(function(error) {
                messages.push(results.error(error));
                return [];
            });
        };
    }

    function noteHtmlId(note) {
        return referentHtmlId(note.noteType, note.noteId);
    }

    function noteRefHtmlId(note) {
        return referenceHtmlId(note.noteType, note.noteId);
    }

    function referentHtmlId(referenceType, referenceId) {
        return htmlId(referenceType + "-" + referenceId);
    }

    function referenceHtmlId(referenceType, referenceId) {
        return htmlId(referenceType + "-ref-" + referenceId);
    }

    function htmlId(suffix) {
        return idPrefix + suffix;
    }

    var defaultTablePath = htmlPaths.elements([
        htmlPaths.element("table", {}, {fresh: true})
    ]);

    function convertTable(element, messages, options) {
        return findHtmlPath(element, defaultTablePath).wrap(function() {
            return convertTableChildren(element, messages, options);
        });
    }

    function convertTableChildren(element, messages, options) {
        var bodyIndex = _.findIndex(element.children, function(child) {
            return !child.type === documents.types.tableRow || !child.isHeader;
        });
        if (bodyIndex === -1) {
            bodyIndex = element.children.length;
        }
        var children;
        if (bodyIndex === 0) {
            children = convertElements(
                element.children,
                messages,
                _.extend({}, options, {isTableHeader: false})
            );
        } else {
            var headRows = convertElements(
                element.children.slice(0, bodyIndex),
                messages,
                _.extend({}, options, {isTableHeader: true})
            );
            var bodyRows = convertElements(
                element.children.slice(bodyIndex),
                messages,
                _.extend({}, options, {isTableHeader: false})
            );
            children = [
                Html.freshElement("thead", {}, headRows),
                Html.freshElement("tbody", {}, bodyRows)
            ];
        }
        return [Html.forceWrite].concat(children);
    }

    function convertTableRow(element, messages, options) {
        var children = convertElements(element.children, messages, options);
        return [
            Html.freshElement("tr", {}, [Html.forceWrite].concat(children))
        ];
    }

    function convertTableCell(element, messages, options) {
        var tagName = options.isTableHeader ? "th" : "td";
        var children = convertElements(element.children, messages, options);
        var attributes = {};
        if (element.colSpan !== 1) {
            attributes.colspan = element.colSpan.toString();
        }
        if (element.rowSpan !== 1) {
            attributes.rowspan = element.rowSpan.toString();
        }

        return [
            Html.freshElement(tagName, attributes, [Html.forceWrite].concat(children))
        ];
    }

    function convertCommentReference(reference, messages, options) {
        return findHtmlPath(reference, htmlPaths.ignore).wrap(function() {
            var comment = comments[reference.commentId];
            var count = referencedComments.length + 1;
            var label = "[" + commentAuthorLabel(comment) + count + "]";
            referencedComments.push({label: label, comment: comment});
            // TODO: remove duplication with note references
            return [
                Html.freshElement("a", {
                    href: "#" + referentHtmlId("comment", reference.commentId),
                    id: referenceHtmlId("comment", reference.commentId)
                }, [Html.text(label)])
            ];
        });
    }

    function convertComment(referencedComment, messages, options) {
        // TODO: remove duplication with note references

        var label = referencedComment.label;
        var comment = referencedComment.comment;
        var body = convertElements(comment.body, messages, options).concat([
            Html.nonFreshElement("p", {}, [
                Html.text(" "),
                Html.freshElement("a", {"href": "#" + referenceHtmlId("comment", comment.commentId)}, [
                    Html.text("↑")
                ])
            ])
        ]);

        return [
            Html.freshElement(
                "dt",
                {"id": referentHtmlId("comment", comment.commentId)},
                [Html.text("Comment " + label)]
            ),
            Html.freshElement("dd", {}, body)
        ];
    }

    function convertBreak(element, messages, options) {
        return htmlPathForBreak(element).wrap(function() {
            return [];
        });
    }

    function htmlPathForBreak(element) {
        var style = findStyle(element);
        if (style) {
            return style.to;
        } else if (element.breakType === "line") {
            return htmlPaths.topLevelElement("br");
        } else {
            return htmlPaths.empty;
        }
    }

    var elementConverters = {
        "document": function(document, messages, options) {
            var children = convertElements(document.children, messages, options);
            var notes = noteReferences.map(function(noteReference) {
                return document.notes.resolve(noteReference);
            });
            var notesNodes = convertElements(notes, messages, options);
            return children.concat([
                Html.freshElement("ol", {}, notesNodes),
                Html.freshElement("dl", {}, flatMap(referencedComments, function(referencedComment) {
                    return convertComment(referencedComment, messages, options);
                }))
            ]);
        },
        "paragraph": convertParagraph,
        "run": convertRun,
        "text": function(element, messages, options) {
            return [Html.text(element.value)];
        },
        "tab": function(element, messages, options) {
            return [Html.text("\t")];
        },
        "hyperlink": function(element, messages, options) {
            var href = element.anchor ? "#" + htmlId(element.anchor) : element.href;
            var attributes = {href: href};
            if (element.targetFrame != null) {
                attributes.target = element.targetFrame;
            }

            var children = convertElements(element.children, messages, options);
            return [Html.nonFreshElement("a", attributes, children)];
        },
        "checkbox": function(element) {
            var attributes = {type: "checkbox"};
            if (element.checked) {
                attributes["checked"] = "checked";
            }
            return [Html.freshElement("input", attributes)];
        },
        "bookmarkStart": function(element, messages, options) {
            var anchor = Html.freshElement("a", {
                id: htmlId(element.name)
            }, [Html.forceWrite]);
            return [anchor];
        },
        "noteReference": function(element, messages, options) {
            noteReferences.push(element);
            var anchor = Html.freshElement("a", {
                href: "#" + noteHtmlId(element),
                id: noteRefHtmlId(element)
            }, [Html.text("[" + (noteNumber++) + "]")]);

            return [Html.freshElement("sup", {}, [anchor])];
        },
        "note": function(element, messages, options) {
            var children = convertElements(element.body, messages, options);
            var backLink = Html.elementWithTag(htmlPaths.element("p", {}, {fresh: false}), [
                Html.text(" "),
                Html.freshElement("a", {href: "#" + noteRefHtmlId(element)}, [Html.text("↑")])
            ]);
            var body = children.concat([backLink]);

            return Html.freshElement("li", {id: noteHtmlId(element)}, body);
        },
        "commentReference": convertCommentReference,
        "comment": convertComment,
        "image": deferredConversion(recoveringConvertImage(options.convertImage || images.dataUri)),
        "table": convertTable,
        "tableRow": convertTableRow,
        "tableCell": convertTableCell,
        "break": convertBreak
    };
    return {
        convertToHtml: convertToHtml
    };
}

var deferredId = 1;

function deferredConversion(func) {
    return function(element, messages, options) {
        return [
            {
                type: "deferred",
                id: deferredId++,
                value: function() {
                    return func(element, messages, options);
                }
            }
        ];
    };
}

function unrecognisedStyleWarning(type, element) {
    return results.warning(
        "Unrecognised " + type + " style: '" + element.styleName + "'" +
        " (Style ID: " + element.styleId + ")"
    );
}

function flatMap(values, func) {
    return _.flatten(values.map(func), true);
}

function walkHtml(nodes, callback) {
    nodes.forEach(function(node) {
        callback(node);
        if (node.children) {
            walkHtml(node.children, callback);
        }
    });
}

var commentAuthorLabel = __webpack_unused_export__ = function commentAuthorLabel(comment) {
    return comment.authorInitials || "";
};


/***/ }),

/***/ 56364:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);

var types = exports.types = {
    document: "document",
    paragraph: "paragraph",
    run: "run",
    text: "text",
    tab: "tab",
    checkbox: "checkbox",
    hyperlink: "hyperlink",
    noteReference: "noteReference",
    image: "image",
    note: "note",
    commentReference: "commentReference",
    comment: "comment",
    table: "table",
    tableRow: "tableRow",
    tableCell: "tableCell",
    "break": "break",
    bookmarkStart: "bookmarkStart"
};

function Document(children, options) {
    options = options || {};
    return {
        type: types.document,
        children: children,
        notes: options.notes || new Notes({}),
        comments: options.comments || []
    };
}

function Paragraph(children, properties) {
    properties = properties || {};
    var indent = properties.indent || {};
    return {
        type: types.paragraph,
        children: children,
        styleId: properties.styleId || null,
        styleName: properties.styleName || null,
        numbering: properties.numbering || null,
        alignment: properties.alignment || null,
        indent: {
            start: indent.start || null,
            end: indent.end || null,
            firstLine: indent.firstLine || null,
            hanging: indent.hanging || null
        }
    };
}

function Run(children, properties) {
    properties = properties || {};
    return {
        type: types.run,
        children: children,
        styleId: properties.styleId || null,
        styleName: properties.styleName || null,
        isBold: !!properties.isBold,
        isUnderline: !!properties.isUnderline,
        isItalic: !!properties.isItalic,
        isStrikethrough: !!properties.isStrikethrough,
        isAllCaps: !!properties.isAllCaps,
        isSmallCaps: !!properties.isSmallCaps,
        verticalAlignment: properties.verticalAlignment || verticalAlignment.baseline,
        font: properties.font || null,
        fontSize: properties.fontSize || null,
        highlight: properties.highlight || null
    };
}

var verticalAlignment = {
    baseline: "baseline",
    superscript: "superscript",
    subscript: "subscript"
};

function Text(value) {
    return {
        type: types.text,
        value: value
    };
}

function Tab() {
    return {
        type: types.tab
    };
}

function Checkbox(options) {
    return {
        type: types.checkbox,
        checked: options.checked
    };
}

function Hyperlink(children, options) {
    return {
        type: types.hyperlink,
        children: children,
        href: options.href,
        anchor: options.anchor,
        targetFrame: options.targetFrame
    };
}

function NoteReference(options) {
    return {
        type: types.noteReference,
        noteType: options.noteType,
        noteId: options.noteId
    };
}

function Notes(notes) {
    this._notes = _.indexBy(notes, function(note) {
        return noteKey(note.noteType, note.noteId);
    });
}

Notes.prototype.resolve = function(reference) {
    return this.findNoteByKey(noteKey(reference.noteType, reference.noteId));
};

Notes.prototype.findNoteByKey = function(key) {
    return this._notes[key] || null;
};

function Note(options) {
    return {
        type: types.note,
        noteType: options.noteType,
        noteId: options.noteId,
        body: options.body
    };
}

function commentReference(options) {
    return {
        type: types.commentReference,
        commentId: options.commentId
    };
}

function comment(options) {
    return {
        type: types.comment,
        commentId: options.commentId,
        body: options.body,
        authorName: options.authorName,
        authorInitials: options.authorInitials
    };
}

function noteKey(noteType, id) {
    return noteType + "-" + id;
}

function Image(options) {
    return {
        type: types.image,
        // `read` is retained for backwards compatibility, but other read
        // methods should be preferred.
        read: function(encoding) {
            if (encoding) {
                return options.readImage(encoding);
            } else {
                return options.readImage().then(function(arrayBuffer) {
                    return Buffer.from(arrayBuffer);
                });
            }
        },
        readAsArrayBuffer: function() {
            return options.readImage();
        },
        readAsBase64String: function() {
            return options.readImage("base64");
        },
        readAsBuffer: function() {
            return options.readImage().then(function(arrayBuffer) {
                return Buffer.from(arrayBuffer);
            });
        },
        altText: options.altText,
        contentType: options.contentType
    };
}

function Table(children, properties) {
    properties = properties || {};
    return {
        type: types.table,
        children: children,
        styleId: properties.styleId || null,
        styleName: properties.styleName || null
    };
}

function TableRow(children, options) {
    options = options || {};
    return {
        type: types.tableRow,
        children: children,
        isHeader: options.isHeader || false
    };
}

function TableCell(children, options) {
    options = options || {};
    return {
        type: types.tableCell,
        children: children,
        colSpan: options.colSpan == null ? 1 : options.colSpan,
        rowSpan: options.rowSpan == null ? 1 : options.rowSpan
    };
}

function Break(breakType) {
    return {
        type: types["break"],
        breakType: breakType
    };
}

function BookmarkStart(options) {
    return {
        type: types.bookmarkStart,
        name: options.name
    };
}

exports.document = exports.Document = Document;
exports.paragraph = exports.Paragraph = Paragraph;
exports.run = exports.Run = Run;
exports.text = exports.Text = Text;
exports.tab = exports.Tab = Tab;
exports.checkbox = exports.Checkbox = Checkbox;
exports.Hyperlink = Hyperlink;
exports.noteReference = exports.NoteReference = NoteReference;
exports.Notes = Notes;
exports.Note = Note;
exports.commentReference = commentReference;
exports.comment = comment;
exports.Image = Image;
exports.Table = Table;
exports.TableRow = TableRow;
exports.TableCell = TableCell;
exports.lineBreak = Break("line");
exports.pageBreak = Break("page");
exports.columnBreak = Break("column");
exports.BookmarkStart = BookmarkStart;

exports.verticalAlignment = verticalAlignment;


/***/ }),

/***/ 22105:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;
exports.M = createBodyReader;
__webpack_unused_export__ = readNumberingProperties;

var dingbatToUnicode = __webpack_require__(97673);
var _ = __webpack_require__(4523);

var documents = __webpack_require__(56364);
var Result = (__webpack_require__(70376).Result);
var warning = (__webpack_require__(70376).warning);
var xml = __webpack_require__(38648);
var transforms = __webpack_require__(54397);
var uris = __webpack_require__(1442);

function createBodyReader(options) {
    return {
        readXmlElement: function(element) {
            return new BodyReader(options).readXmlElement(element);
        },
        readXmlElements: function(elements) {
            return new BodyReader(options).readXmlElements(elements);
        }
    };
}

function BodyReader(options) {
    var complexFieldStack = [];
    var currentInstrText = [];

    // When a paragraph is marked as deleted, its contents should be combined
    // with the following paragraph. See 17.13.5.15 del (Deleted Paragraph) of
    // ECMA-376 4th edition Part 1.
    var deletedParagraphContents = [];

    var relationships = options.relationships;
    var contentTypes = options.contentTypes;
    var docxFile = options.docxFile;
    var files = options.files;
    var numbering = options.numbering;
    var styles = options.styles;

    function readXmlElements(elements) {
        var results = elements.map(readXmlElement);
        return combineResults(results);
    }

    function readXmlElement(element) {
        if (element.type === "element") {
            var handler = xmlElementReaders[element.name];
            if (handler) {
                return handler(element);
            } else if (!Object.prototype.hasOwnProperty.call(ignoreElements, element.name)) {
                var message = warning("An unrecognised element was ignored: " + element.name);
                return emptyResultWithMessages([message]);
            }
        }
        return emptyResult();
    }

    function readParagraphProperties(element) {
        return readParagraphStyle(element).map(function(style) {
            return {
                type: "paragraphProperties",
                styleId: style.styleId,
                styleName: style.name,
                alignment: element.firstOrEmpty("w:jc").attributes["w:val"],
                numbering: readNumberingProperties(style.styleId, element.firstOrEmpty("w:numPr"), numbering),
                indent: readParagraphIndent(element.firstOrEmpty("w:ind"))
            };
        });
    }

    function readParagraphIndent(element) {
        return {
            start: element.attributes["w:start"] || element.attributes["w:left"],
            end: element.attributes["w:end"] || element.attributes["w:right"],
            firstLine: element.attributes["w:firstLine"],
            hanging: element.attributes["w:hanging"]
        };
    }

    function readRunProperties(element) {
        return readRunStyle(element).map(function(style) {
            var fontSizeString = element.firstOrEmpty("w:sz").attributes["w:val"];
            // w:sz gives the font size in half points, so halve the value to get the size in points
            var fontSize = /^[0-9]+$/.test(fontSizeString) ? parseInt(fontSizeString, 10) / 2 : null;

            return {
                type: "runProperties",
                styleId: style.styleId,
                styleName: style.name,
                verticalAlignment: element.firstOrEmpty("w:vertAlign").attributes["w:val"],
                font: element.firstOrEmpty("w:rFonts").attributes["w:ascii"],
                fontSize: fontSize,
                isBold: readBooleanElement(element.first("w:b")),
                isUnderline: readUnderline(element.first("w:u")),
                isItalic: readBooleanElement(element.first("w:i")),
                isStrikethrough: readBooleanElement(element.first("w:strike")),
                isAllCaps: readBooleanElement(element.first("w:caps")),
                isSmallCaps: readBooleanElement(element.first("w:smallCaps")),
                highlight: readHighlightValue(element.firstOrEmpty("w:highlight").attributes["w:val"])
            };
        });
    }

    function readUnderline(element) {
        if (element) {
            var value = element.attributes["w:val"];
            return value !== undefined && value !== "false" && value !== "0" && value !== "none";
        } else {
            return false;
        }
    }

    function readBooleanElement(element) {
        if (element) {
            var value = element.attributes["w:val"];
            return value !== "false" && value !== "0";
        } else {
            return false;
        }
    }

    function readBooleanAttributeValue(value) {
        return value !== "false" && value !== "0";
    }

    function readHighlightValue(value) {
        if (!value || value === "none") {
            return null;
        } else {
            return value;
        }
    }

    function readParagraphStyle(element) {
        return readStyle(element, "w:pStyle", "Paragraph", styles.findParagraphStyleById);
    }

    function readRunStyle(element) {
        return readStyle(element, "w:rStyle", "Run", styles.findCharacterStyleById);
    }

    function readTableStyle(element) {
        return readStyle(element, "w:tblStyle", "Table", styles.findTableStyleById);
    }

    function readStyle(element, styleTagName, styleType, findStyleById) {
        var messages = [];
        var styleElement = element.first(styleTagName);
        var styleId = null;
        var name = null;
        if (styleElement) {
            styleId = styleElement.attributes["w:val"];
            if (styleId) {
                var style = findStyleById(styleId);
                if (style) {
                    name = style.name;
                } else {
                    messages.push(undefinedStyleWarning(styleType, styleId));
                }
            }
        }
        return elementResultWithMessages({styleId: styleId, name: name}, messages);
    }

    function readFldChar(element) {
        var type = element.attributes["w:fldCharType"];
        if (type === "begin") {
            complexFieldStack.push({type: "begin", fldChar: element});
            currentInstrText = [];
        } else if (type === "end") {
            var complexFieldEnd = complexFieldStack.pop();
            if (complexFieldEnd.type === "begin") {
                complexFieldEnd = parseCurrentInstrText(complexFieldEnd);
            }
            if (complexFieldEnd.type === "checkbox") {
                return elementResult(documents.checkbox({
                    checked: complexFieldEnd.checked
                }));
            }
        } else if (type === "separate") {
            var complexFieldSeparate = complexFieldStack.pop();
            var complexField = parseCurrentInstrText(complexFieldSeparate);
            complexFieldStack.push(complexField);
        }
        return emptyResult();
    }

    function currentHyperlinkOptions() {
        var topHyperlink = _.last(complexFieldStack.filter(function(complexField) {
            return complexField.type === "hyperlink";
        }));
        return topHyperlink ? topHyperlink.options : null;
    }

    function parseCurrentInstrText(complexField) {
        return parseInstrText(
            currentInstrText.join(''),
            complexField.type === "begin"
                ? complexField.fldChar
                : xml.emptyElement
        );
    }

    function parseInstrText(instrText, fldChar) {
        var linkResult = /^\s*HYPERLINK\s+(\\l\s+)?(?:"(.*)"|([^\\]\S*))/.exec(instrText);
        if (linkResult) {
            var location = linkResult[2] === undefined ? linkResult[3] : linkResult[2];
            var options = linkResult[1] === undefined ? {href: location} : {anchor: location};
            return {type: "hyperlink", options: options};
        }

        var checkboxResult = /\s*FORMCHECKBOX\s*/.exec(instrText);
        if (checkboxResult) {
            var checkboxElement = fldChar
                .firstOrEmpty("w:ffData")
                .firstOrEmpty("w:checkBox");
            var checkedElement = checkboxElement.first("w:checked");
            var checked = checkedElement == null
                ? readBooleanElement(checkboxElement.first("w:default"))
                : readBooleanElement(checkedElement);
            return {type: "checkbox", checked: checked};
        }

        return {type: "unknown"};
    }

    function readInstrText(element) {
        currentInstrText.push(element.text());
        return emptyResult();
    }

    function readSymbol(element) {
        // See 17.3.3.30 sym (Symbol Character) of ECMA-376 4th edition Part 1
        var font = element.attributes["w:font"];
        var char = element.attributes["w:char"];
        var unicodeCharacter = dingbatToUnicode.hex(font, char);
        if (unicodeCharacter == null && /^F0..$/.test(char)) {
            unicodeCharacter = dingbatToUnicode.hex(font, char.substring(2));
        }

        if (unicodeCharacter == null) {
            return emptyResultWithMessages([warning(
                "A w:sym element with an unsupported character was ignored: char " +  char + " in font " + font
            )]);
        } else {
            return elementResult(new documents.Text(unicodeCharacter.string));
        }
    }

    function noteReferenceReader(noteType) {
        return function(element) {
            var noteId = element.attributes["w:id"];
            return elementResult(new documents.NoteReference({
                noteType: noteType,
                noteId: noteId
            }));
        };
    }

    function readCommentReference(element) {
        return elementResult(documents.commentReference({
            commentId: element.attributes["w:id"]
        }));
    }

    function readChildElements(element) {
        return readXmlElements(element.children);
    }

    var xmlElementReaders = {
        "w:p": function(element) {
            var paragraphPropertiesElement = element.firstOrEmpty("w:pPr");

            var isDeleted = !!paragraphPropertiesElement
                .firstOrEmpty("w:rPr")
                .first("w:del");

            if (isDeleted) {
                element.children.forEach(function(child) {
                    deletedParagraphContents.push(child);
                });
                return emptyResult();
            } else {
                var childrenXml = element.children;
                if (deletedParagraphContents.length > 0) {
                    childrenXml = deletedParagraphContents.concat(childrenXml);
                    deletedParagraphContents = [];
                }
                return ReadResult.map(
                    readParagraphProperties(paragraphPropertiesElement),
                    readXmlElements(childrenXml),
                    function(properties, children) {
                        return new documents.Paragraph(children, properties);
                    }
                ).insertExtra();
            }
        },
        "w:r": function(element) {
            return ReadResult.map(
                readRunProperties(element.firstOrEmpty("w:rPr")),
                readXmlElements(element.children),
                function(properties, children) {
                    var hyperlinkOptions = currentHyperlinkOptions();
                    if (hyperlinkOptions !== null) {
                        children = [new documents.Hyperlink(children, hyperlinkOptions)];
                    }

                    return new documents.Run(children, properties);
                }
            );
        },
        "w:fldChar": readFldChar,
        "w:instrText": readInstrText,
        "w:t": function(element) {
            return elementResult(new documents.Text(element.text()));
        },
        "w:tab": function(element) {
            return elementResult(new documents.Tab());
        },
        "w:noBreakHyphen": function() {
            return elementResult(new documents.Text("\u2011"));
        },
        "w:softHyphen": function(element) {
            return elementResult(new documents.Text("\u00AD"));
        },
        "w:sym": readSymbol,
        "w:hyperlink": function(element) {
            var relationshipId = element.attributes["r:id"];
            var anchor = element.attributes["w:anchor"];
            return readXmlElements(element.children).map(function(children) {
                function create(options) {
                    var targetFrame = element.attributes["w:tgtFrame"] || null;

                    return new documents.Hyperlink(
                        children,
                        _.extend({targetFrame: targetFrame}, options)
                    );
                }

                if (relationshipId) {
                    var href = relationships.findTargetByRelationshipId(relationshipId);
                    if (anchor) {
                        href = uris.replaceFragment(href, anchor);
                    }
                    return create({href: href});
                } else if (anchor) {
                    return create({anchor: anchor});
                } else {
                    return children;
                }
            });
        },
        "w:tbl": readTable,
        "w:tr": readTableRow,
        "w:tc": readTableCell,
        "w:footnoteReference": noteReferenceReader("footnote"),
        "w:endnoteReference": noteReferenceReader("endnote"),
        "w:commentReference": readCommentReference,
        "w:br": function(element) {
            var breakType = element.attributes["w:type"];
            if (breakType == null || breakType === "textWrapping") {
                return elementResult(documents.lineBreak);
            } else if (breakType === "page") {
                return elementResult(documents.pageBreak);
            } else if (breakType === "column") {
                return elementResult(documents.columnBreak);
            } else {
                return emptyResultWithMessages([warning("Unsupported break type: " + breakType)]);
            }
        },
        "w:bookmarkStart": function(element){
            var name = element.attributes["w:name"];
            if (name === "_GoBack") {
                return emptyResult();
            } else {
                return elementResult(new documents.BookmarkStart({name: name}));
            }
        },

        "mc:AlternateContent": function(element) {
            return readChildElements(element.firstOrEmpty("mc:Fallback"));
        },

        "w:sdt": function(element) {
            var contentResult = readXmlElements(element.firstOrEmpty("w:sdtContent").children);
            return contentResult.map(function(content) {
                // From the WordML standard: https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/3350cb64-931f-41f7-8824-f18b2568ce66
                //
                // > A CT_SdtCheckbox element that specifies that the parent
                // > structured document tag is a checkbox when displayed in the
                // > document. The parent structured document tag contents MUST
                // > contain a single character and optionally an additional
                // > character in a deleted run.

                var checkbox = element
                    .firstOrEmpty("w:sdtPr")
                    .first("wordml:checkbox");

                if (checkbox) {
                    var checkedElement = checkbox.first("wordml:checked");
                    var isChecked = !!checkedElement && readBooleanAttributeValue(
                        checkedElement.attributes["wordml:val"]
                    );
                    var documentCheckbox = documents.checkbox({
                        checked: isChecked
                    });

                    var hasCheckbox = false;
                    var replacedContent = content.map(transforms._elementsOfType(
                        documents.types.text,
                        function(text) {
                            if (text.value.length > 0 && !hasCheckbox) {
                                hasCheckbox = true;
                                return documentCheckbox;
                            } else {
                                return text;
                            }
                        }
                    ));

                    if (hasCheckbox) {
                        return replacedContent;
                    } else {
                        return documentCheckbox;
                    }

                } else {
                    return content;
                }
            });
        },

        "w:ins": readChildElements,
        "w:object": readChildElements,
        "w:smartTag": readChildElements,
        "w:drawing": readChildElements,
        "w:pict": function(element) {
            return readChildElements(element).toExtra();
        },
        "v:roundrect": readChildElements,
        "v:shape": readChildElements,
        "v:textbox": readChildElements,
        "w:txbxContent": readChildElements,
        "wp:inline": readDrawingElement,
        "wp:anchor": readDrawingElement,
        "v:imagedata": readImageData,
        "v:group": readChildElements,
        "v:rect": readChildElements
    };

    return {
        readXmlElement: readXmlElement,
        readXmlElements: readXmlElements
    };


    function readTable(element) {
        var propertiesResult = readTableProperties(element.firstOrEmpty("w:tblPr"));
        return readXmlElements(element.children)
            .flatMap(calculateRowSpans)
            .flatMap(function(children) {
                return propertiesResult.map(function(properties) {
                    return documents.Table(children, properties);
                });
            });
    }

    function readTableProperties(element) {
        return readTableStyle(element).map(function(style) {
            return {
                styleId: style.styleId,
                styleName: style.name
            };
        });
    }

    function readTableRow(element) {
        var properties = element.firstOrEmpty("w:trPr");

        // See 17.13.5.12 del (Deleted Table Row) of ECMA-376 4th edition Part 1
        var isDeleted = !!properties.first("w:del");
        if (isDeleted) {
            return emptyResult();
        }

        var isHeader = !!properties.first("w:tblHeader");
        return readXmlElements(element.children).map(function(children) {
            return documents.TableRow(children, {isHeader: isHeader});
        });
    }

    function readTableCell(element) {
        return readXmlElements(element.children).map(function(children) {
            var properties = element.firstOrEmpty("w:tcPr");

            var gridSpan = properties.firstOrEmpty("w:gridSpan").attributes["w:val"];
            var colSpan = gridSpan ? parseInt(gridSpan, 10) : 1;

            var cell = documents.TableCell(children, {colSpan: colSpan});
            cell._vMerge = readVMerge(properties);
            return cell;
        });
    }

    function readVMerge(properties) {
        var element = properties.first("w:vMerge");
        if (element) {
            var val = element.attributes["w:val"];
            return val === "continue" || !val;
        } else {
            return null;
        }
    }

    function calculateRowSpans(rows) {
        var unexpectedNonRows = _.any(rows, function(row) {
            return row.type !== documents.types.tableRow;
        });
        if (unexpectedNonRows) {
            removeVMergeProperties(rows);
            return elementResultWithMessages(rows, [warning(
                "unexpected non-row element in table, cell merging may be incorrect"
            )]);
        }
        var unexpectedNonCells = _.any(rows, function(row) {
            return _.any(row.children, function(cell) {
                return cell.type !== documents.types.tableCell;
            });
        });
        if (unexpectedNonCells) {
            removeVMergeProperties(rows);
            return elementResultWithMessages(rows, [warning(
                "unexpected non-cell element in table row, cell merging may be incorrect"
            )]);
        }

        var columns = {};

        rows.forEach(function(row) {
            var cellIndex = 0;
            row.children.forEach(function(cell) {
                if (cell._vMerge && columns[cellIndex]) {
                    columns[cellIndex].rowSpan++;
                } else {
                    columns[cellIndex] = cell;
                    cell._vMerge = false;
                }
                cellIndex += cell.colSpan;
            });
        });

        rows.forEach(function(row) {
            row.children = row.children.filter(function(cell) {
                return !cell._vMerge;
            });
            row.children.forEach(function(cell) {
                delete cell._vMerge;
            });
        });

        return elementResult(rows);
    }

    function removeVMergeProperties(rows) {
        rows.forEach(function(row) {
            var cells = transforms.getDescendantsOfType(row, documents.types.tableCell);
            cells.forEach(function(cell) {
                delete cell._vMerge;
            });
        });
    }

    function readDrawingElement(element) {
        var blips = element
            .getElementsByTagName("a:graphic")
            .getElementsByTagName("a:graphicData")
            .getElementsByTagName("pic:pic")
            .getElementsByTagName("pic:blipFill")
            .getElementsByTagName("a:blip");

        return combineResults(blips.map(readBlip.bind(null, element)));
    }

    function readBlip(element, blip) {
        var propertiesElement = element.firstOrEmpty("wp:docPr");
        var properties = propertiesElement.attributes;

        var altText = isBlank(properties.descr) ? properties.title : properties.descr;

        var blipImageFile = findBlipImageFile(blip);
        if (blipImageFile === null) {
            return emptyResultWithMessages([warning("Could not find image file for a:blip element")]);
        }

        return readImage(blipImageFile, altText).map(function(imageElement) {
            var hlinkClickElement = propertiesElement.firstOrEmpty("a:hlinkClick");
            var relationshipId = hlinkClickElement.attributes["r:id"];
            if (relationshipId) {
                var href = relationships.findTargetByRelationshipId(relationshipId);
                return new documents.Hyperlink([imageElement], {href: href});
            } else {
                return imageElement;
            }
        });
    }

    function isBlank(value) {
        return value == null || /^\s*$/.test(value);
    }

    function findBlipImageFile(blip) {
        var embedRelationshipId = blip.attributes["r:embed"];
        var linkRelationshipId = blip.attributes["r:link"];
        if (embedRelationshipId) {
            return findEmbeddedImageFile(embedRelationshipId);
        } else if (linkRelationshipId) {
            var imagePath = relationships.findTargetByRelationshipId(linkRelationshipId);
            return {
                path: imagePath,
                read: files.read.bind(files, imagePath)
            };
        } else {
            return null;
        }
    }

    function readImageData(element) {
        var relationshipId = element.attributes['r:id'];

        if (relationshipId) {
            return readImage(
                findEmbeddedImageFile(relationshipId),
                element.attributes["o:title"]);
        } else {
            return emptyResultWithMessages([warning("A v:imagedata element without a relationship ID was ignored")]);
        }
    }

    function findEmbeddedImageFile(relationshipId) {
        var path = uris.uriToZipEntryName("word", relationships.findTargetByRelationshipId(relationshipId));
        return {
            path: path,
            read: docxFile.read.bind(docxFile, path)
        };
    }

    function readImage(imageFile, altText) {
        var contentType = contentTypes.findContentType(imageFile.path);

        var image = documents.Image({
            readImage: imageFile.read,
            altText: altText,
            contentType: contentType
        });
        var warnings = supportedImageTypes[contentType] ?
            [] : warning("Image of type " + contentType + " is unlikely to display in web browsers");
        return elementResultWithMessages(image, warnings);
    }

    function undefinedStyleWarning(type, styleId) {
        return warning(
            type + " style with ID " + styleId + " was referenced but not defined in the document");
    }
}


function readNumberingProperties(styleId, element, numbering) {
    var level = element.firstOrEmpty("w:ilvl").attributes["w:val"];
    var numId = element.firstOrEmpty("w:numId").attributes["w:val"];
    if (level !== undefined && numId !== undefined) {
        return numbering.findLevel(numId, level);
    }

    if (styleId != null) {
        var levelByStyleId = numbering.findLevelByParagraphStyleId(styleId);
        if (levelByStyleId != null) {
            return levelByStyleId;
        }
    }

    // Some malformed documents define numbering levels without an index, and
    // reference the numbering using a w:numPr element without a w:ilvl child.
    // To handle such cases, we assume a level of 0 as a fallback.
    if (numId !== undefined) {
        return numbering.findLevel(numId, "0");
    }

    return null;
}

var supportedImageTypes = {
    "image/png": true,
    "image/gif": true,
    "image/jpeg": true,
    "image/svg+xml": true,
    "image/tiff": true
};

var ignoreElements = {
    "office-word:wrap": true,
    "v:shadow": true,
    "v:shapetype": true,
    "w:annotationRef": true,
    "w:bookmarkEnd": true,
    "w:sectPr": true,
    "w:proofErr": true,
    "w:lastRenderedPageBreak": true,
    "w:commentRangeStart": true,
    "w:commentRangeEnd": true,
    "w:del": true,
    "w:footnoteRef": true,
    "w:endnoteRef": true,
    "w:pPr": true,
    "w:rPr": true,
    "w:tblPr": true,
    "w:tblGrid": true,
    "w:trPr": true,
    "w:tcPr": true
};

function emptyResultWithMessages(messages) {
    return new ReadResult(null, null, messages);
}

function emptyResult() {
    return new ReadResult(null);
}

function elementResult(element) {
    return new ReadResult(element);
}

function elementResultWithMessages(element, messages) {
    return new ReadResult(element, null, messages);
}

function ReadResult(element, extra, messages) {
    this.value = element || [];
    this.extra = extra || [];
    this._result = new Result({
        element: this.value,
        extra: extra
    }, messages);
    this.messages = this._result.messages;
}

ReadResult.prototype.toExtra = function() {
    return new ReadResult(null, joinElements(this.extra, this.value), this.messages);
};

ReadResult.prototype.insertExtra = function() {
    var extra = this.extra;
    if (extra && extra.length) {
        return new ReadResult(joinElements(this.value, extra), null, this.messages);
    } else {
        return this;
    }
};

ReadResult.prototype.map = function(func) {
    var result = this._result.map(function(value) {
        return func(value.element);
    });
    return new ReadResult(result.value, this.extra, result.messages);
};

ReadResult.prototype.flatMap = function(func) {
    var result = this._result.flatMap(function(value) {
        return func(value.element)._result;
    });
    return new ReadResult(result.value.element, joinElements(this.extra, result.value.extra), result.messages);
};

ReadResult.map = function(first, second, func) {
    return new ReadResult(
        func(first.value, second.value),
        joinElements(first.extra, second.extra),
        first.messages.concat(second.messages)
    );
};

function combineResults(results) {
    var result = Result.combine(_.pluck(results, "_result"));
    return new ReadResult(
        _.flatten(_.pluck(result.value, "element")),
        _.filter(_.flatten(_.pluck(result.value, "extra")), identity),
        result.messages
    );
}

function joinElements(first, second) {
    return _.flatten([first, second]);
}

function identity(value) {
    return value;
}


/***/ }),

/***/ 54068:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var documents = __webpack_require__(56364);
var Result = (__webpack_require__(70376).Result);

function createCommentsReader(bodyReader) {
    function readCommentsXml(element) {
        return Result.combine(element.getElementsByTagName("w:comment")
            .map(readCommentElement));
    }

    function readCommentElement(element) {
        var id = element.attributes["w:id"];

        function readOptionalAttribute(name) {
            return (element.attributes[name] || "").trim() || null;
        }

        return bodyReader.readXmlElements(element.children)
            .map(function(body) {
                return documents.comment({
                    commentId: id,
                    body: body,
                    authorName: readOptionalAttribute("w:author"),
                    authorInitials: readOptionalAttribute("w:initials")
                });
            });
    }
    
    return readCommentsXml;
}

exports.createCommentsReader = createCommentsReader;


/***/ }),

/***/ 40578:
/***/ (function(__unused_webpack_module, exports) {

exports.readContentTypesFromXml = readContentTypesFromXml;

var fallbackContentTypes = {
    "png": "png",
    "gif": "gif",
    "jpeg": "jpeg",
    "jpg": "jpeg",
    "tif": "tiff",
    "tiff": "tiff",
    "bmp": "bmp"
};

exports.defaultContentTypes = contentTypes({}, {});


function readContentTypesFromXml(element) {
    var extensionDefaults = {};
    var overrides = {};
    
    element.children.forEach(function(child) {
        if (child.name === "content-types:Default") {
            extensionDefaults[child.attributes.Extension] = child.attributes.ContentType;
        }
        if (child.name === "content-types:Override") {
            var name = child.attributes.PartName;
            if (name.charAt(0) === "/") {
                name = name.substring(1);
            }
            overrides[name] = child.attributes.ContentType;
        }
    });
    return contentTypes(overrides, extensionDefaults);
}

function contentTypes(overrides, extensionDefaults) {
    return {
        findContentType: function(path) {
            var overrideContentType = overrides[path];
            if (overrideContentType) {
                return overrideContentType;
            } else {
                var pathParts = path.split(".");
                var extension = pathParts[pathParts.length - 1];
                if (extensionDefaults.hasOwnProperty(extension)) {
                    return extensionDefaults[extension];
                } else {
                    var fallback = fallbackContentTypes[extension.toLowerCase()];
                    if (fallback) {
                        return "image/" + fallback;
                    } else {
                        return null;
                    }
                }
            }
        }
    };
    
}


/***/ }),

/***/ 51386:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

exports.O = DocumentXmlReader;

var documents = __webpack_require__(56364);
var Result = (__webpack_require__(70376).Result);


function DocumentXmlReader(options) {
    var bodyReader = options.bodyReader;

    function convertXmlToDocument(element) {
        var body = element.first("w:body");

        if (body == null) {
            throw new Error("Could not find the body element: are you sure this is a docx file?");
        }

        var result = bodyReader.readXmlElements(body.children)
            .map(function(children) {
                return new documents.Document(children, {
                    notes: options.notes,
                    comments: options.comments
                });
            });
        return new Result(result.value, result.messages);
    }

    return {
        convertXmlToDocument: convertXmlToDocument
    };
}


/***/ }),

/***/ 70175:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

exports.read = read;
exports._findPartPaths = findPartPaths;

var promises = __webpack_require__(45818);
var documents = __webpack_require__(56364);
var Result = (__webpack_require__(70376).Result);
var zipfile = __webpack_require__(27227);

var readXmlFromZipFile = (__webpack_require__(30433)/* .readXmlFromZipFile */ .V);
var createBodyReader = (__webpack_require__(22105)/* .createBodyReader */ .M);
var DocumentXmlReader = (__webpack_require__(51386)/* .DocumentXmlReader */ .O);
var relationshipsReader = __webpack_require__(47000);
var contentTypesReader = __webpack_require__(40578);
var numberingXml = __webpack_require__(74794);
var stylesReader = __webpack_require__(21343);
var notesReader = __webpack_require__(83686);
var commentsReader = __webpack_require__(54068);
var Files = (__webpack_require__(61719)/* .Files */ .s);


function read(docxFile, input, options) {
    input = input || {};
    options = options || {};

    var files = new Files({
        externalFileAccess: options.externalFileAccess,
        relativeToFile: input.path
    });

    return promises.props({
        contentTypes: readContentTypesFromZipFile(docxFile),
        partPaths: findPartPaths(docxFile),
        docxFile: docxFile,
        files: files
    }).also(function(result) {
        return {
            styles: readStylesFromZipFile(docxFile, result.partPaths.styles)
        };
    }).also(function(result) {
        return {
            numbering: readNumberingFromZipFile(docxFile, result.partPaths.numbering, result.styles)
        };
    }).also(function(result) {
        return {
            footnotes: readXmlFileWithBody(result.partPaths.footnotes, result, function(bodyReader, xml) {
                if (xml) {
                    return notesReader.createFootnotesReader(bodyReader)(xml);
                } else {
                    return new Result([]);
                }
            }),
            endnotes: readXmlFileWithBody(result.partPaths.endnotes, result, function(bodyReader, xml) {
                if (xml) {
                    return notesReader.createEndnotesReader(bodyReader)(xml);
                } else {
                    return new Result([]);
                }
            }),
            comments: readXmlFileWithBody(result.partPaths.comments, result, function(bodyReader, xml) {
                if (xml) {
                    return commentsReader.createCommentsReader(bodyReader)(xml);
                } else {
                    return new Result([]);
                }
            })
        };
    }).also(function(result) {
        return {
            notes: result.footnotes.flatMap(function(footnotes) {
                return result.endnotes.map(function(endnotes) {
                    return new documents.Notes(footnotes.concat(endnotes));
                });
            })
        };
    }).then(function(result) {
        return readXmlFileWithBody(result.partPaths.mainDocument, result, function(bodyReader, xml) {
            return result.notes.flatMap(function(notes) {
                return result.comments.flatMap(function(comments) {
                    var reader = new DocumentXmlReader({
                        bodyReader: bodyReader,
                        notes: notes,
                        comments: comments
                    });
                    return reader.convertXmlToDocument(xml);
                });
            });
        });
    });
}

function findPartPaths(docxFile) {
    return readPackageRelationships(docxFile).then(function(packageRelationships) {
        var mainDocumentPath = findPartPath({
            docxFile: docxFile,
            relationships: packageRelationships,
            relationshipType: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
            basePath: "",
            fallbackPath: "word/document.xml"
        });

        if (!docxFile.exists(mainDocumentPath)) {
            throw new Error("Could not find main document part. Are you sure this is a valid .docx file?");
        }

        return xmlFileReader({
            filename: relationshipsFilename(mainDocumentPath),
            readElement: relationshipsReader.readRelationships,
            defaultValue: relationshipsReader.defaultValue
        })(docxFile).then(function(documentRelationships) {
            function findPartRelatedToMainDocument(name) {
                return findPartPath({
                    docxFile: docxFile,
                    relationships: documentRelationships,
                    relationshipType: "http://schemas.openxmlformats.org/officeDocument/2006/relationships/" + name,
                    basePath: zipfile.splitPath(mainDocumentPath).dirname,
                    fallbackPath: "word/" + name + ".xml"
                });
            }

            return {
                mainDocument: mainDocumentPath,
                comments: findPartRelatedToMainDocument("comments"),
                endnotes: findPartRelatedToMainDocument("endnotes"),
                footnotes: findPartRelatedToMainDocument("footnotes"),
                numbering: findPartRelatedToMainDocument("numbering"),
                styles: findPartRelatedToMainDocument("styles")
            };
        });
    });
}

function findPartPath(options) {
    var docxFile = options.docxFile;
    var relationships = options.relationships;
    var relationshipType = options.relationshipType;
    var basePath = options.basePath;
    var fallbackPath = options.fallbackPath;

    var targets = relationships.findTargetsByType(relationshipType);
    var normalisedTargets = targets.map(function(target) {
        return stripPrefix(zipfile.joinPath(basePath, target), "/");
    });
    var validTargets = normalisedTargets.filter(function(target) {
        return docxFile.exists(target);
    });
    if (validTargets.length === 0) {
        return fallbackPath;
    } else {
        return validTargets[0];
    }
}

function stripPrefix(value, prefix) {
    if (value.substring(0, prefix.length) === prefix) {
        return value.substring(prefix.length);
    } else {
        return value;
    }
}

function xmlFileReader(options) {
    return function(zipFile) {
        return readXmlFromZipFile(zipFile, options.filename)
            .then(function(element) {
                return element ? options.readElement(element) : options.defaultValue;
            });
    };
}

function readXmlFileWithBody(filename, options, func) {
    var readRelationshipsFromZipFile = xmlFileReader({
        filename: relationshipsFilename(filename),
        readElement: relationshipsReader.readRelationships,
        defaultValue: relationshipsReader.defaultValue
    });

    return readRelationshipsFromZipFile(options.docxFile).then(function(relationships) {
        var bodyReader = new createBodyReader({
            relationships: relationships,
            contentTypes: options.contentTypes,
            docxFile: options.docxFile,
            numbering: options.numbering,
            styles: options.styles,
            files: options.files
        });
        return readXmlFromZipFile(options.docxFile, filename)
            .then(function(xml) {
                return func(bodyReader, xml);
            });
    });
}

function relationshipsFilename(filename) {
    var split = zipfile.splitPath(filename);
    return zipfile.joinPath(split.dirname, "_rels", split.basename + ".rels");
}

var readContentTypesFromZipFile = xmlFileReader({
    filename: "[Content_Types].xml",
    readElement: contentTypesReader.readContentTypesFromXml,
    defaultValue: contentTypesReader.defaultContentTypes
});

function readNumberingFromZipFile(zipFile, path, styles) {
    return xmlFileReader({
        filename: path,
        readElement: function(element) {
            return numberingXml.readNumberingXml(element, {styles: styles});
        },
        defaultValue: numberingXml.defaultNumbering
    })(zipFile);
}

function readStylesFromZipFile(zipFile, path) {
    return xmlFileReader({
        filename: path,
        readElement: stylesReader.readStylesXml,
        defaultValue: stylesReader.defaultStyles
    })(zipFile);
}

var readPackageRelationships = xmlFileReader({
    filename: "_rels/.rels",
    readElement: relationshipsReader.readRelationships,
    defaultValue: relationshipsReader.defaultValue
});


/***/ }),

/***/ 83686:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var documents = __webpack_require__(56364);
var Result = (__webpack_require__(70376).Result);

exports.createFootnotesReader = createReader.bind(this, "footnote");
exports.createEndnotesReader = createReader.bind(this, "endnote");

function createReader(noteType, bodyReader) {
    function readNotesXml(element) {
        return Result.combine(element.getElementsByTagName("w:" + noteType)
            .filter(isFootnoteElement)
            .map(readFootnoteElement));
    }

    function isFootnoteElement(element) {
        var type = element.attributes["w:type"];
        return type !== "continuationSeparator" && type !== "separator";
    }

    function readFootnoteElement(footnoteElement) {
        var id = footnoteElement.attributes["w:id"];
        return bodyReader.readXmlElements(footnoteElement.children)
            .map(function(body) {
                return documents.Note({noteType: noteType, noteId: id, body: body});
            });
    }
    
    return readNotesXml;
}


/***/ }),

/***/ 74794:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);

exports.readNumberingXml = readNumberingXml;
exports.Numbering = Numbering;
exports.defaultNumbering = new Numbering({}, {});

function Numbering(nums, abstractNums, styles) {
    var allLevels = _.flatten(_.values(abstractNums).map(function(abstractNum) {
        return _.values(abstractNum.levels);
    }));

    var levelsByParagraphStyleId = _.indexBy(
        allLevels.filter(function(level) {
            return level.paragraphStyleId != null;
        }),
        "paragraphStyleId"
    );

    function findLevel(numId, level) {
        var num = nums[numId];
        if (num) {
            var abstractNum = abstractNums[num.abstractNumId];
            if (!abstractNum) {
                return null;
            } else if (abstractNum.numStyleLink == null) {
                return abstractNums[num.abstractNumId].levels[level];
            } else {
                var style = styles.findNumberingStyleById(abstractNum.numStyleLink);
                return findLevel(style.numId, level);
            }
        } else {
            return null;
        }
    }

    function findLevelByParagraphStyleId(styleId) {
        return levelsByParagraphStyleId[styleId] || null;
    }

    return {
        findLevel: findLevel,
        findLevelByParagraphStyleId: findLevelByParagraphStyleId
    };
}

function readNumberingXml(root, options) {
    if (!options || !options.styles) {
        throw new Error("styles is missing");
    }

    var abstractNums = readAbstractNums(root);
    var nums = readNums(root, abstractNums);
    return new Numbering(nums, abstractNums, options.styles);
}

function readAbstractNums(root) {
    var abstractNums = {};
    root.getElementsByTagName("w:abstractNum").forEach(function(element) {
        var id = element.attributes["w:abstractNumId"];
        abstractNums[id] = readAbstractNum(element);
    });
    return abstractNums;
}

function readAbstractNum(element) {
    var levels = {};

    // Some malformed documents define numbering levels without an index, and
    // reference the numbering using a w:numPr element without a w:ilvl child.
    // To handle such cases, we assume a level of 0 as a fallback.
    var levelWithoutIndex = null;

    element.getElementsByTagName("w:lvl").forEach(function(levelElement) {
        var levelIndex = levelElement.attributes["w:ilvl"];
        var numFmt = levelElement.firstOrEmpty("w:numFmt").attributes["w:val"];
        var isOrdered = numFmt !== "bullet";
        var paragraphStyleId = levelElement.firstOrEmpty("w:pStyle").attributes["w:val"];

        if (levelIndex === undefined) {
            levelWithoutIndex = {
                isOrdered: isOrdered,
                level: "0",
                paragraphStyleId: paragraphStyleId
            };
        } else {
            levels[levelIndex] = {
                isOrdered: isOrdered,
                level: levelIndex,
                paragraphStyleId: paragraphStyleId
            };
        }
    });

    if (levelWithoutIndex !== null && levels[levelWithoutIndex.level] === undefined) {
        levels[levelWithoutIndex.level] = levelWithoutIndex;
    }

    var numStyleLink = element.firstOrEmpty("w:numStyleLink").attributes["w:val"];

    return {levels: levels, numStyleLink: numStyleLink};
}

function readNums(root) {
    var nums = {};
    root.getElementsByTagName("w:num").forEach(function(element) {
        var numId = element.attributes["w:numId"];
        var abstractNumId = element.first("w:abstractNumId").attributes["w:val"];
        nums[numId] = {abstractNumId: abstractNumId};
    });
    return nums;
}


/***/ }),

/***/ 30433:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;
var _ = __webpack_require__(4523);

var promises = __webpack_require__(45818);
var xml = __webpack_require__(38648);


__webpack_unused_export__ = read;
exports.V = readXmlFromZipFile;

var xmlNamespaceMap = {
    // Transitional format
    "http://schemas.openxmlformats.org/wordprocessingml/2006/main": "w",
    "http://schemas.openxmlformats.org/officeDocument/2006/relationships": "r",
    "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing": "wp",
    "http://schemas.openxmlformats.org/drawingml/2006/main": "a",
    "http://schemas.openxmlformats.org/drawingml/2006/picture": "pic",

    // Strict format
    "http://purl.oclc.org/ooxml/wordprocessingml/main": "w",
    "http://purl.oclc.org/ooxml/officeDocument/relationships": "r",
    "http://purl.oclc.org/ooxml/drawingml/wordprocessingDrawing": "wp",
    "http://purl.oclc.org/ooxml/drawingml/main": "a",
    "http://purl.oclc.org/ooxml/drawingml/picture": "pic",

    // Common
    "http://schemas.openxmlformats.org/package/2006/content-types": "content-types",
    "http://schemas.openxmlformats.org/package/2006/relationships": "relationships",
    "http://schemas.openxmlformats.org/markup-compatibility/2006": "mc",
    "urn:schemas-microsoft-com:vml": "v",
    "urn:schemas-microsoft-com:office:word": "office-word",

    // [MS-DOCX]: Word Extensions to the Office Open XML (.docx) File Format
    // https://learn.microsoft.com/en-us/openspecs/office_standards/ms-docx/b839fe1f-e1ca-4fa6-8c26-5954d0abbccd
    "http://schemas.microsoft.com/office/word/2010/wordml": "wordml"
};


function read(xmlString) {
    return xml.readString(xmlString, xmlNamespaceMap)
        .then(function(document) {
            return collapseAlternateContent(document)[0];
        });
}


function readXmlFromZipFile(docxFile, path) {
    if (docxFile.exists(path)) {
        return docxFile.read(path, "utf-8")
            .then(stripUtf8Bom)
            .then(read);
    } else {
        return promises.resolve(null);
    }
}


function stripUtf8Bom(xmlString) {
    return xmlString.replace(/^\uFEFF/g, '');
}


function collapseAlternateContent(node) {
    if (node.type === "element") {
        if (node.name === "mc:AlternateContent") {
            return node.firstOrEmpty("mc:Fallback").children;
        } else {
            node.children = _.flatten(node.children.map(collapseAlternateContent, true));
            return [node];
        }
    } else {
        return [node];
    }
}


/***/ }),

/***/ 47000:
/***/ (function(__unused_webpack_module, exports) {

exports.readRelationships = readRelationships;
exports.defaultValue = new Relationships([]);
exports.Relationships = Relationships;


function readRelationships(element) {
    var relationships = [];
    element.children.forEach(function(child) {
        if (child.name === "relationships:Relationship") {
            var relationship = {
                relationshipId: child.attributes.Id,
                target: child.attributes.Target,
                type: child.attributes.Type
            };
            relationships.push(relationship);
        }
    });
    return new Relationships(relationships);
}

function Relationships(relationships) {
    var targetsByRelationshipId = {};
    relationships.forEach(function(relationship) {
        targetsByRelationshipId[relationship.relationshipId] = relationship.target;
    });

    var targetsByType = {};
    relationships.forEach(function(relationship) {
        if (!targetsByType[relationship.type]) {
            targetsByType[relationship.type] = [];
        }
        targetsByType[relationship.type].push(relationship.target);
    });

    return {
        findTargetByRelationshipId: function(relationshipId) {
            return targetsByRelationshipId[relationshipId];
        },
        findTargetsByType: function(type) {
            return targetsByType[type] || [];
        }
    };
}


/***/ }),

/***/ 65331:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);

var promises = __webpack_require__(45818);
var xml = __webpack_require__(38648);

exports.writeStyleMap = writeStyleMap;
exports.readStyleMap = readStyleMap;


var schema = "http://schemas.zwobble.org/mammoth/style-map";
var styleMapPath = "mammoth/style-map";
var styleMapAbsolutePath = "/" + styleMapPath;

function writeStyleMap(docxFile, styleMap) {
    docxFile.write(styleMapPath, styleMap);
    return updateRelationships(docxFile).then(function() {
        return updateContentTypes(docxFile);
    });
}

function updateRelationships(docxFile) {
    var path = "word/_rels/document.xml.rels";
    var relationshipsUri = "http://schemas.openxmlformats.org/package/2006/relationships";
    var relationshipElementName = "{" + relationshipsUri + "}Relationship";
    return docxFile.read(path, "utf8")
        .then(xml.readString)
        .then(function(relationshipsContainer) {
            var relationships = relationshipsContainer.children;
            addOrUpdateElement(relationships, relationshipElementName, "Id", {
                "Id": "rMammothStyleMap",
                "Type": schema,
                "Target": styleMapAbsolutePath
            });
            
            var namespaces = {"": relationshipsUri};
            return docxFile.write(path, xml.writeString(relationshipsContainer, namespaces));
        });
}

function updateContentTypes(docxFile) {
    var path = "[Content_Types].xml";
    var contentTypesUri = "http://schemas.openxmlformats.org/package/2006/content-types";
    var overrideName = "{" + contentTypesUri + "}Override";
    return docxFile.read(path, "utf8")
        .then(xml.readString)
        .then(function(typesElement) {
            var children = typesElement.children;
            addOrUpdateElement(children, overrideName, "PartName", {
                "PartName": styleMapAbsolutePath,
                "ContentType": "text/prs.mammoth.style-map"
            });
            var namespaces = {"": contentTypesUri};
            return docxFile.write(path, xml.writeString(typesElement, namespaces));
        });
}

function addOrUpdateElement(elements, name, identifyingAttribute, attributes) {
    var existingElement = _.find(elements, function(element) {
        return element.name === name &&
            element.attributes[identifyingAttribute] === attributes[identifyingAttribute];
    });
    if (existingElement) {
        existingElement.attributes = attributes;
    } else {
        elements.push(xml.element(name, attributes));
    }
}

function readStyleMap(docxFile) {
    if (docxFile.exists(styleMapPath)) {
        return docxFile.read(styleMapPath, "utf8");
    } else {
        return promises.resolve(null);
    }
}


/***/ }),

/***/ 21343:
/***/ (function(__unused_webpack_module, exports) {

exports.readStylesXml = readStylesXml;
exports.Styles = Styles;
exports.defaultStyles = new Styles({}, {});

function Styles(paragraphStyles, characterStyles, tableStyles, numberingStyles) {
    return {
        findParagraphStyleById: function(styleId) {
            return paragraphStyles[styleId];
        },
        findCharacterStyleById: function(styleId) {
            return characterStyles[styleId];
        },
        findTableStyleById: function(styleId) {
            return tableStyles[styleId];
        },
        findNumberingStyleById: function(styleId) {
            return numberingStyles[styleId];
        }
    };
}

Styles.EMPTY = new Styles({}, {}, {}, {});

function readStylesXml(root) {
    var paragraphStyles = {};
    var characterStyles = {};
    var tableStyles = {};
    var numberingStyles = {};

    var styles = {
        "paragraph": paragraphStyles,
        "character": characterStyles,
        "table": tableStyles,
        "numbering": numberingStyles
    };

    root.getElementsByTagName("w:style").forEach(function(styleElement) {
        var style = readStyleElement(styleElement);
        var styleSet = styles[style.type];

        // Per 17.7.4.17 style (Style Definition) of ECMA-376 4th edition Part 1:
        //
        // > If multiple style definitions each declare the same value for their
        // > styleId, then the first such instance shall keep its current
        // > identifier with all other instances being reassigned in any manner
        // > desired.
        //
        // For the purpose of conversion, there's no point holding onto styles
        // with reassigned style IDs, so we ignore such style definitions.

        if (styleSet && styleSet[style.styleId] === undefined) {
            styleSet[style.styleId] = style;
        }
    });

    return new Styles(paragraphStyles, characterStyles, tableStyles, numberingStyles);
}

function readStyleElement(styleElement) {
    var type = styleElement.attributes["w:type"];

    if (type === "numbering") {
        return readNumberingStyleElement(type, styleElement);
    } else {
        var styleId = readStyleId(styleElement);
        var name = styleName(styleElement);
        return {type: type, styleId: styleId, name: name};
    }
}

function styleName(styleElement) {
    var nameElement = styleElement.first("w:name");
    return nameElement ? nameElement.attributes["w:val"] : null;
}

function readNumberingStyleElement(type, styleElement) {
    var styleId = readStyleId(styleElement);

    var numId = styleElement
        .firstOrEmpty("w:pPr")
        .firstOrEmpty("w:numPr")
        .firstOrEmpty("w:numId")
        .attributes["w:val"];

    return {type: type, numId: numId, styleId: styleId};
}

function readStyleId(styleElement) {
    return styleElement.attributes["w:styleId"];
}


/***/ }),

/***/ 1442:
/***/ (function(__unused_webpack_module, exports) {

exports.uriToZipEntryName = uriToZipEntryName;
exports.replaceFragment = replaceFragment;

function uriToZipEntryName(base, uri) {
    if (uri.charAt(0) === "/") {
        return uri.substr(1);
    } else {
        // In general, we should check first and second for trailing and leading slashes,
        // but in our specific case this seems to be sufficient
        return base + "/" + uri;
    }
}


function replaceFragment(uri, fragment) {
    var hashIndex = uri.indexOf("#");
    if (hashIndex !== -1) {
        uri = uri.substring(0, hashIndex);
    }
    return uri + "#" + fragment;
}


/***/ }),

/***/ 86514:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var htmlPaths = __webpack_require__(72761);


function nonFreshElement(tagName, attributes, children) {
    return elementWithTag(
        htmlPaths.element(tagName, attributes, {fresh: false}),
        children);
}

function freshElement(tagName, attributes, children) {
    var tag = htmlPaths.element(tagName, attributes, {fresh: true});
    return elementWithTag(tag, children);
}

function elementWithTag(tag, children) {
    return {
        type: "element",
        tag: tag,
        children: children || []
    };
}

function text(value) {
    return {
        type: "text",
        value: value
    };
}

var forceWrite = {
    type: "forceWrite"
};

exports.freshElement = freshElement;
exports.nonFreshElement = nonFreshElement;
exports.elementWithTag = elementWithTag;
exports.text = text;
exports.forceWrite = forceWrite;

var voidTagNames = {
    "br": true,
    "hr": true,
    "img": true,
    "input": true
};

function isVoidElement(node) {
    return (node.children.length === 0) && voidTagNames[node.tag.tagName];
}

exports.isVoidElement = isVoidElement;


/***/ }),

/***/ 61754:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var ast = __webpack_require__(86514);

exports.freshElement = ast.freshElement;
exports.nonFreshElement = ast.nonFreshElement;
exports.elementWithTag = ast.elementWithTag;
exports.text = ast.text;
exports.forceWrite = ast.forceWrite;

exports.simplify = __webpack_require__(35695);

function write(writer, nodes) {
    nodes.forEach(function(node) {
        writeNode(writer, node);
    });
}

function writeNode(writer, node) {
    toStrings[node.type](writer, node);
}

var toStrings = {
    element: generateElementString,
    text: generateTextString,
    forceWrite: function() { }
};

function generateElementString(writer, node) {
    if (ast.isVoidElement(node)) {
        writer.selfClosing(node.tag.tagName, node.tag.attributes);
    } else {
        writer.open(node.tag.tagName, node.tag.attributes);
        write(writer, node.children);
        writer.close(node.tag.tagName);
    }
}

function generateTextString(writer, node) {
    writer.text(node.value);
}

exports.write = write;


/***/ }),

/***/ 35695:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

var _ = __webpack_require__(4523);

var ast = __webpack_require__(86514);

function simplify(nodes) {
    return collapse(removeEmpty(nodes));
}

function collapse(nodes) {
    var children = [];
    
    nodes.map(collapseNode).forEach(function(child) {
        appendChild(children, child);
    });
    return children;
}

function collapseNode(node) {
    return collapsers[node.type](node);
}

var collapsers = {
    element: collapseElement,
    text: identity,
    forceWrite: identity
};

function collapseElement(node) {
    return ast.elementWithTag(node.tag, collapse(node.children));
}

function identity(value) {
    return value;
}

function appendChild(children, child) {
    var lastChild = children[children.length - 1];
    if (child.type === "element" && !child.tag.fresh && lastChild && lastChild.type === "element" && child.tag.matchesElement(lastChild.tag)) {
        if (child.tag.separator) {
            appendChild(lastChild.children, ast.text(child.tag.separator));
        }
        child.children.forEach(function(grandChild) {
            // Mutation is fine since simplifying elements create a copy of the children.
            appendChild(lastChild.children, grandChild);
        });
    } else {
        children.push(child);
    }
}

function removeEmpty(nodes) {
    return flatMap(nodes, function(node) {
        return emptiers[node.type](node);
    });
}

function flatMap(values, func) {
    return _.flatten(_.map(values, func), true);
}

var emptiers = {
    element: elementEmptier,
    text: textEmptier,
    forceWrite: neverEmpty
};

function neverEmpty(node) {
    return [node];
}

function elementEmptier(element) {
    var children = removeEmpty(element.children);
    if (children.length === 0 && !ast.isVoidElement(element)) {
        return [];
    } else {
        return [ast.elementWithTag(element.tag, children)];
    }
}

function textEmptier(node) {
    if (node.value.length === 0) {
        return [];
    } else {
        return [node];
    }
}

module.exports = simplify;


/***/ }),

/***/ 41842:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);

var promises = __webpack_require__(45818);
var Html = __webpack_require__(61754);

exports.imgElement = imgElement;

function imgElement(func) {
    return function(element, messages) {
        return promises.when(func(element)).then(function(result) {
            var attributes = {};
            if (element.altText) {
                attributes.alt = element.altText;
            }
            _.extend(attributes, result);

            return [Html.freshElement("img", attributes)];
        });
    };
}

// Undocumented, but retained for backwards-compatibility with 0.3.x
exports.inline = exports.imgElement;

exports.dataUri = imgElement(function(element) {
    return element.readAsBase64String().then(function(imageBuffer) {
        return {
            src: "data:" + element.contentType + ";base64," + imageBuffer
        };
    });
});


/***/ }),

/***/ 70306:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;
var _ = __webpack_require__(4523);

var docxReader = __webpack_require__(70175);
var docxStyleMap = __webpack_require__(65331);
var DocumentConverter = (__webpack_require__(5773)/* .DocumentConverter */ .w);
var convertElementToRawText = (__webpack_require__(66802)/* .convertElementToRawText */ .w);
var readStyle = (__webpack_require__(15203)/* .readStyle */ ._T);
var readOptions = (__webpack_require__(68986)/* .readOptions */ .Tt);
var unzip = __webpack_require__(42051);
var Result = (__webpack_require__(70376).Result);

exports.convertToHtml = convertToHtml;
__webpack_unused_export__ = convertToMarkdown;
__webpack_unused_export__ = convert;
__webpack_unused_export__ = extractRawText;
/* unused reexport */ __webpack_require__(41842);
/* unused reexport */ __webpack_require__(54397);
/* unused reexport */ __webpack_require__(40374);
__webpack_unused_export__ = embedStyleMap;
__webpack_unused_export__ = readEmbeddedStyleMap;

function convertToHtml(input, options) {
    return convert(input, options);
}

function convertToMarkdown(input, options) {
    var markdownOptions = Object.create(options || {});
    markdownOptions.outputFormat = "markdown";
    return convert(input, markdownOptions);
}

function convert(input, options) {
    options = readOptions(options);

    return unzip.openZip(input)
        .tap(function(docxFile) {
            return docxStyleMap.readStyleMap(docxFile).then(function(styleMap) {
                options.embeddedStyleMap = styleMap;
            });
        })
        .then(function(docxFile) {
            return docxReader.read(docxFile, input, options)
                .then(function(documentResult) {
                    return documentResult.map(options.transformDocument);
                })
                .then(function(documentResult) {
                    return convertDocumentToHtml(documentResult, options);
                });
        });
}

function readEmbeddedStyleMap(input) {
    return unzip.openZip(input)
        .then(docxStyleMap.readStyleMap);
}

function convertDocumentToHtml(documentResult, options) {
    var styleMapResult = parseStyleMap(options.readStyleMap());
    var parsedOptions = _.extend({}, options, {
        styleMap: styleMapResult.value
    });
    var documentConverter = new DocumentConverter(parsedOptions);

    return documentResult.flatMapThen(function(document) {
        return styleMapResult.flatMapThen(function(styleMap) {
            return documentConverter.convertToHtml(document);
        });
    });
}

function parseStyleMap(styleMap) {
    return Result.combine((styleMap || []).map(readStyle))
        .map(function(styleMap) {
            return styleMap.filter(function(styleMapping) {
                return !!styleMapping;
            });
        });
}


function extractRawText(input) {
    return unzip.openZip(input)
        .then(docxReader.read)
        .then(function(documentResult) {
            return documentResult.map(convertElementToRawText);
        });
}

function embedStyleMap(input, styleMap) {
    return unzip.openZip(input)
        .tap(function(docxFile) {
            return docxStyleMap.writeStyleMap(docxFile, styleMap);
        })
        .then(function(docxFile) {
            return docxFile.toArrayBuffer();
        })
        .then(function(arrayBuffer) {
            return {
                toArrayBuffer: function() {
                    return arrayBuffer;
                },
                toBuffer: function() {
                    return Buffer.from(arrayBuffer);
                }
            };
        });
}

__webpack_unused_export__ = function() {
    throw new Error('Use a raw string instead of mammoth.styleMapping e.g. "p[style-name=\'Title\'] => h1" instead of mammoth.styleMapping("p[style-name=\'Title\'] => h1")');
};


/***/ }),

/***/ 68986:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;
exports.Tt = readOptions;


var _ = __webpack_require__(4523);

var defaultStyleMap = __webpack_unused_export__ = [
    "p.Heading1 => h1:fresh",
    "p.Heading2 => h2:fresh",
    "p.Heading3 => h3:fresh",
    "p.Heading4 => h4:fresh",
    "p.Heading5 => h5:fresh",
    "p.Heading6 => h6:fresh",
    "p[style-name='Heading 1'] => h1:fresh",
    "p[style-name='Heading 2'] => h2:fresh",
    "p[style-name='Heading 3'] => h3:fresh",
    "p[style-name='Heading 4'] => h4:fresh",
    "p[style-name='Heading 5'] => h5:fresh",
    "p[style-name='Heading 6'] => h6:fresh",
    "p[style-name='heading 1'] => h1:fresh",
    "p[style-name='heading 2'] => h2:fresh",
    "p[style-name='heading 3'] => h3:fresh",
    "p[style-name='heading 4'] => h4:fresh",
    "p[style-name='heading 5'] => h5:fresh",
    "p[style-name='heading 6'] => h6:fresh",

    // Apple Pages
    "p.Heading => h1:fresh",
    "p[style-name='Heading'] => h1:fresh",

    "r[style-name='Strong'] => strong",

    "p[style-name='footnote text'] => p:fresh",
    "r[style-name='footnote reference'] =>",
    "p[style-name='endnote text'] => p:fresh",
    "r[style-name='endnote reference'] =>",
    "p[style-name='annotation text'] => p:fresh",
    "r[style-name='annotation reference'] =>",

    // LibreOffice
    "p[style-name='Footnote'] => p:fresh",
    "r[style-name='Footnote anchor'] =>",
    "p[style-name='Endnote'] => p:fresh",
    "r[style-name='Endnote anchor'] =>",

    "p:unordered-list(1) => ul > li:fresh",
    "p:unordered-list(2) => ul|ol > li > ul > li:fresh",
    "p:unordered-list(3) => ul|ol > li > ul|ol > li > ul > li:fresh",
    "p:unordered-list(4) => ul|ol > li > ul|ol > li > ul|ol > li > ul > li:fresh",
    "p:unordered-list(5) => ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ul > li:fresh",
    "p:ordered-list(1) => ol > li:fresh",
    "p:ordered-list(2) => ul|ol > li > ol > li:fresh",
    "p:ordered-list(3) => ul|ol > li > ul|ol > li > ol > li:fresh",
    "p:ordered-list(4) => ul|ol > li > ul|ol > li > ul|ol > li > ol > li:fresh",
    "p:ordered-list(5) => ul|ol > li > ul|ol > li > ul|ol > li > ul|ol > li > ol > li:fresh",

    "r[style-name='Hyperlink'] =>",

    "p[style-name='Normal'] => p:fresh",

    // Apple Pages
    "p.Body => p:fresh",
    "p[style-name='Body'] => p:fresh"
];

var standardOptions = __webpack_unused_export__ = {
    externalFileAccess: false,
    transformDocument: identity,
    includeDefaultStyleMap: true,
    includeEmbeddedStyleMap: true
};

function readOptions(options) {
    options = options || {};
    return _.extend({}, standardOptions, options, {
        customStyleMap: readStyleMap(options.styleMap),
        readStyleMap: function() {
            var styleMap = this.customStyleMap;
            if (this.includeEmbeddedStyleMap) {
                styleMap = styleMap.concat(readStyleMap(this.embeddedStyleMap));
            }
            if (this.includeDefaultStyleMap) {
                styleMap = styleMap.concat(defaultStyleMap);
            }
            return styleMap;
        }
    });
}

function readStyleMap(styleMap) {
    if (!styleMap) {
        return [];
    } else if (_.isString(styleMap)) {
        return styleMap.split("\n")
            .map(function(line) {
                return line.trim();
            })
            .filter(function(line) {
                return line !== "" && line.charAt(0) !== "#";
            });
    } else {
        return styleMap;
    }
}

function identity(value) {
    return value;
}


/***/ }),

/***/ 45818:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);
var bluebird = __webpack_require__(88410)();

exports.defer = defer;
exports.when = bluebird.resolve;
exports.resolve = bluebird.resolve;
exports.all = bluebird.all;
exports.props = bluebird.props;
exports.reject = bluebird.reject;
exports.promisify = bluebird.promisify;
exports.mapSeries = bluebird.mapSeries;
exports.attempt = bluebird.attempt;

exports.nfcall = function(func) {
    var args = Array.prototype.slice.call(arguments, 1);
    var promisedFunc = bluebird.promisify(func);
    return promisedFunc.apply(null, args);
};

bluebird.prototype.fail = bluebird.prototype.caught;

bluebird.prototype.also = function(func) {
    return this.then(function(value) {
        var returnValue = _.extend({}, value, func(value));
        return bluebird.props(returnValue);
    });
};

function defer() {
    var resolve;
    var reject;
    var promise = new bluebird.Promise(function(resolveArg, rejectArg) {
        resolve = resolveArg;
        reject = rejectArg;
    });

    return {
        resolve: resolve,
        reject: reject,
        promise: promise
    };
}


/***/ }),

/***/ 66802:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var documents = __webpack_require__(56364);

function convertElementToRawText(element) {
    if (element.type === "text") {
        return element.value;
    } else if (element.type === documents.types.tab) {
        return "\t";
    } else {
        var tail = element.type === "paragraph" ? "\n\n" : "";
        return (element.children || []).map(convertElementToRawText).join("") + tail;
    }
}

exports.w = convertElementToRawText;


/***/ }),

/***/ 70376:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);


exports.Result = Result;
exports.success = success;
exports.warning = warning;
exports.error = error;


function Result(value, messages) {
    this.value = value;
    this.messages = messages || [];
}

Result.prototype.map = function(func) {
    return new Result(func(this.value), this.messages);
};

Result.prototype.flatMap = function(func) {
    var funcResult = func(this.value);
    return new Result(funcResult.value, combineMessages([this, funcResult]));
};

Result.prototype.flatMapThen = function(func) {
    var that = this;
    return func(this.value).then(function(otherResult) {
        return new Result(otherResult.value, combineMessages([that, otherResult]));
    });
};

Result.combine = function(results) {
    var values = _.flatten(_.pluck(results, "value"));
    var messages = combineMessages(results);
    return new Result(values, messages);
};

function success(value) {
    return new Result(value, []);
}

function warning(message) {
    return {
        type: "warning",
        message: message
    };
}

function error(exception) {
    return {
        type: "error",
        message: exception.message,
        error: exception
    };
}

function combineMessages(results) {
    var messages = [];
    _.flatten(_.pluck(results, "messages"), true).forEach(function(message) {
        if (!containsMessage(messages, message)) {
            messages.push(message);
        }
    });
    return messages;
}

function containsMessage(messages, message) {
    return _.find(messages, isSameMessage.bind(null, message)) !== undefined;
}

function isSameMessage(first, second) {
    return first.type === second.type && first.message === second.message;
}


/***/ }),

/***/ 15203:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;
var _ = __webpack_require__(4523);
var lop = __webpack_require__(96324);

var documentMatchers = __webpack_require__(87730);
var htmlPaths = __webpack_require__(72761);
var tokenise = (__webpack_require__(16039)/* .tokenise */ .t);
var results = __webpack_require__(70376);

__webpack_unused_export__ = readHtmlPath;
__webpack_unused_export__ = readDocumentMatcher;
exports._T = readStyle;


function readStyle(string) {
    return parseString(styleRule, string);
}

function createStyleRule() {
    return lop.rules.sequence(
        lop.rules.sequence.capture(documentMatcherRule()),
        lop.rules.tokenOfType("whitespace"),
        lop.rules.tokenOfType("arrow"),
        lop.rules.sequence.capture(lop.rules.optional(lop.rules.sequence(
            lop.rules.tokenOfType("whitespace"),
            lop.rules.sequence.capture(htmlPathRule())
        ).head())),
        lop.rules.tokenOfType("end")
    ).map(function(documentMatcher, htmlPath) {
        return {
            from: documentMatcher,
            to: htmlPath.valueOrElse(htmlPaths.empty)
        };
    });
}

function readDocumentMatcher(string) {
    return parseString(documentMatcherRule(), string);
}

function documentMatcherRule() {
    var sequence = lop.rules.sequence;

    var identifierToConstant = function(identifier, constant) {
        return lop.rules.then(
            lop.rules.token("identifier", identifier),
            function() {
                return constant;
            }
        );
    };

    var paragraphRule = identifierToConstant("p", documentMatchers.paragraph);
    var runRule = identifierToConstant("r", documentMatchers.run);

    var elementTypeRule = lop.rules.firstOf("p or r or table",
        paragraphRule,
        runRule
    );

    var styleIdRule = lop.rules.sequence(
        lop.rules.tokenOfType("dot"),
        lop.rules.sequence.cut(),
        lop.rules.sequence.capture(identifierRule)
    ).map(function(styleId) {
        return {styleId: styleId};
    });

    var styleNameMatcherRule = lop.rules.firstOf("style name matcher",
        lop.rules.then(
            lop.rules.sequence(
                lop.rules.tokenOfType("equals"),
                lop.rules.sequence.cut(),
                lop.rules.sequence.capture(stringRule)
            ).head(),
            function(styleName) {
                return {styleName: documentMatchers.equalTo(styleName)};
            }
        ),
        lop.rules.then(
            lop.rules.sequence(
                lop.rules.tokenOfType("startsWith"),
                lop.rules.sequence.cut(),
                lop.rules.sequence.capture(stringRule)
            ).head(),
            function(styleName) {
                return {styleName: documentMatchers.startsWith(styleName)};
            }
        )
    );

    var styleNameRule = lop.rules.sequence(
        lop.rules.tokenOfType("open-square-bracket"),
        lop.rules.sequence.cut(),
        lop.rules.token("identifier", "style-name"),
        lop.rules.sequence.capture(styleNameMatcherRule),
        lop.rules.tokenOfType("close-square-bracket")
    ).head();


    var listTypeRule = lop.rules.firstOf("list type",
        identifierToConstant("ordered-list", {isOrdered: true}),
        identifierToConstant("unordered-list", {isOrdered: false})
    );
    var listRule = sequence(
        lop.rules.tokenOfType("colon"),
        sequence.capture(listTypeRule),
        sequence.cut(),
        lop.rules.tokenOfType("open-paren"),
        sequence.capture(integerRule),
        lop.rules.tokenOfType("close-paren")
    ).map(function(listType, levelNumber) {
        return {
            list: {
                isOrdered: listType.isOrdered,
                levelIndex: levelNumber - 1
            }
        };
    });

    function createMatcherSuffixesRule(rules) {
        var matcherSuffix = lop.rules.firstOf.apply(
            lop.rules.firstOf,
            ["matcher suffix"].concat(rules)
        );
        var matcherSuffixes = lop.rules.zeroOrMore(matcherSuffix);
        return lop.rules.then(matcherSuffixes, function(suffixes) {
            var matcherOptions = {};
            suffixes.forEach(function(suffix) {
                _.extend(matcherOptions, suffix);
            });
            return matcherOptions;
        });
    }

    var paragraphOrRun = sequence(
        sequence.capture(elementTypeRule),
        sequence.capture(createMatcherSuffixesRule([
            styleIdRule,
            styleNameRule,
            listRule
        ]))
    ).map(function(createMatcher, matcherOptions) {
        return createMatcher(matcherOptions);
    });

    var table = sequence(
        lop.rules.token("identifier", "table"),
        sequence.capture(createMatcherSuffixesRule([
            styleIdRule,
            styleNameRule
        ]))
    ).map(function(options) {
        return documentMatchers.table(options);
    });

    var bold = identifierToConstant("b", documentMatchers.bold);
    var italic = identifierToConstant("i", documentMatchers.italic);
    var underline = identifierToConstant("u", documentMatchers.underline);
    var strikethrough = identifierToConstant("strike", documentMatchers.strikethrough);
    var allCaps = identifierToConstant("all-caps", documentMatchers.allCaps);
    var smallCaps = identifierToConstant("small-caps", documentMatchers.smallCaps);

    var highlight = sequence(
        lop.rules.token("identifier", "highlight"),
        lop.rules.sequence.capture(lop.rules.optional(lop.rules.sequence(
            lop.rules.tokenOfType("open-square-bracket"),
            lop.rules.sequence.cut(),
            lop.rules.token("identifier", "color"),
            lop.rules.tokenOfType("equals"),
            lop.rules.sequence.capture(stringRule),
            lop.rules.tokenOfType("close-square-bracket")
        ).head()))
    ).map(function(color) {
        return documentMatchers.highlight({
            color: color.valueOrElse(undefined)
        });
    });

    var commentReference = identifierToConstant("comment-reference", documentMatchers.commentReference);

    var breakMatcher = sequence(
        lop.rules.token("identifier", "br"),
        sequence.cut(),
        lop.rules.tokenOfType("open-square-bracket"),
        lop.rules.token("identifier", "type"),
        lop.rules.tokenOfType("equals"),
        sequence.capture(stringRule),
        lop.rules.tokenOfType("close-square-bracket")
    ).map(function(breakType) {
        switch (breakType) {
        case "line":
            return documentMatchers.lineBreak;
        case "page":
            return documentMatchers.pageBreak;
        case "column":
            return documentMatchers.columnBreak;
        default:
            // TODO: handle unknown document matchers
        }
    });

    return lop.rules.firstOf("element type",
        paragraphOrRun,
        table,
        bold,
        italic,
        underline,
        strikethrough,
        allCaps,
        smallCaps,
        highlight,
        commentReference,
        breakMatcher
    );
}

function readHtmlPath(string) {
    return parseString(htmlPathRule(), string);
}

function htmlPathRule() {
    var capture = lop.rules.sequence.capture;
    var whitespaceRule = lop.rules.tokenOfType("whitespace");
    var freshRule = lop.rules.then(
        lop.rules.optional(lop.rules.sequence(
            lop.rules.tokenOfType("colon"),
            lop.rules.token("identifier", "fresh")
        )),
        function(option) {
            return option.map(function() {
                return true;
            }).valueOrElse(false);
        }
    );

    var separatorRule = lop.rules.then(
        lop.rules.optional(lop.rules.sequence(
            lop.rules.tokenOfType("colon"),
            lop.rules.token("identifier", "separator"),
            lop.rules.tokenOfType("open-paren"),
            capture(stringRule),
            lop.rules.tokenOfType("close-paren")
        ).head()),
        function(option) {
            return option.valueOrElse("");
        }
    );

    var tagNamesRule = lop.rules.oneOrMoreWithSeparator(
        identifierRule,
        lop.rules.tokenOfType("choice")
    );

    var styleElementRule = lop.rules.sequence(
        capture(tagNamesRule),
        capture(lop.rules.zeroOrMore(attributeOrClassRule)),
        capture(freshRule),
        capture(separatorRule)
    ).map(function(tagName, attributesList, fresh, separator) {
        var attributes = {};
        var options = {};
        attributesList.forEach(function(attribute) {
            if (attribute.append && attributes[attribute.name]) {
                attributes[attribute.name] += " " + attribute.value;
            } else {
                attributes[attribute.name] = attribute.value;
            }
        });
        if (fresh) {
            options.fresh = true;
        }
        if (separator) {
            options.separator = separator;
        }
        return htmlPaths.element(tagName, attributes, options);
    });

    return lop.rules.firstOf("html path",
        lop.rules.then(lop.rules.tokenOfType("bang"), function() {
            return htmlPaths.ignore;
        }),
        lop.rules.then(
            lop.rules.zeroOrMoreWithSeparator(
                styleElementRule,
                lop.rules.sequence(
                    whitespaceRule,
                    lop.rules.tokenOfType("gt"),
                    whitespaceRule
                )
            ),
            htmlPaths.elements
        )
    );
}

var identifierRule = lop.rules.then(
    lop.rules.tokenOfType("identifier"),
    decodeEscapeSequences
);
var integerRule = lop.rules.tokenOfType("integer");

var stringRule = lop.rules.then(
    lop.rules.tokenOfType("string"),
    decodeEscapeSequences
);

var escapeSequences = {
    "n": "\n",
    "r": "\r",
    "t": "\t"
};

function decodeEscapeSequences(value) {
    return value.replace(/\\(.)/g, function(match, code) {
        return escapeSequences[code] || code;
    });
}

var attributeRule = lop.rules.sequence(
    lop.rules.tokenOfType("open-square-bracket"),
    lop.rules.sequence.cut(),
    lop.rules.sequence.capture(identifierRule),
    lop.rules.tokenOfType("equals"),
    lop.rules.sequence.capture(stringRule),
    lop.rules.tokenOfType("close-square-bracket")
).map(function(name, value) {
    return {name: name, value: value, append: false};
});

var classRule = lop.rules.sequence(
    lop.rules.tokenOfType("dot"),
    lop.rules.sequence.cut(),
    lop.rules.sequence.capture(identifierRule)
).map(function(className) {
    return {name: "class", value: className, append: true};
});

var attributeOrClassRule = lop.rules.firstOf(
    "attribute or class",
    attributeRule,
    classRule
);

function parseString(rule, string) {
    var tokens = tokenise(string);
    var parser = lop.Parser();
    var parseResult = parser.parseTokens(rule, tokens);
    if (parseResult.isSuccess()) {
        return results.success(parseResult.value());
    } else {
        return new results.Result(null, [results.warning(describeFailure(string, parseResult))]);
    }
}

function describeFailure(input, parseResult) {
    return "Did not understand this style mapping, so ignored it: " + input + "\n" +
        parseResult.errors().map(describeError).join("\n");
}

function describeError(error) {
    return "Error was at character number " + error.characterNumber() + ": " +
        "Expected " + error.expected + " but got " + error.actual;
}

var styleRule = createStyleRule();


/***/ }),

/***/ 87730:
/***/ (function(__unused_webpack_module, exports) {

exports.paragraph = paragraph;
exports.run = run;
exports.table = table;
exports.bold = new Matcher("bold");
exports.italic = new Matcher("italic");
exports.underline = new Matcher("underline");
exports.strikethrough = new Matcher("strikethrough");
exports.allCaps = new Matcher("allCaps");
exports.smallCaps = new Matcher("smallCaps");
exports.highlight = highlight;
exports.commentReference = new Matcher("commentReference");
exports.lineBreak = new BreakMatcher({breakType: "line"});
exports.pageBreak = new BreakMatcher({breakType: "page"});
exports.columnBreak = new BreakMatcher({breakType: "column"});
exports.equalTo = equalTo;
exports.startsWith = startsWith;


function paragraph(options) {
    return new Matcher("paragraph", options);
}

function run(options) {
    return new Matcher("run", options);
}

function table(options) {
    return new Matcher("table", options);
}

function highlight(options) {
    return new HighlightMatcher(options);
}

function Matcher(elementType, options) {
    options = options || {};
    this._elementType = elementType;
    this._styleId = options.styleId;
    this._styleName = options.styleName;
    if (options.list) {
        this._listIndex = options.list.levelIndex;
        this._listIsOrdered = options.list.isOrdered;
    }
}

Matcher.prototype.matches = function(element) {
    return element.type === this._elementType &&
        (this._styleId === undefined || element.styleId === this._styleId) &&
        (this._styleName === undefined || (element.styleName && this._styleName.operator(this._styleName.operand, element.styleName))) &&
        (this._listIndex === undefined || isList(element, this._listIndex, this._listIsOrdered)) &&
        (this._breakType === undefined || this._breakType === element.breakType);
};

function HighlightMatcher(options) {
    options = options || {};
    this._color = options.color;
}

HighlightMatcher.prototype.matches = function(element) {
    return element.type === "highlight" &&
        (this._color === undefined || element.color === this._color);
};

function BreakMatcher(options) {
    options = options || {};
    this._breakType = options.breakType;
}

BreakMatcher.prototype.matches = function(element) {
    return element.type === "break" &&
        (this._breakType === undefined || element.breakType === this._breakType);
};

function isList(element, levelIndex, isOrdered) {
    return element.numbering &&
        element.numbering.level == levelIndex &&
        element.numbering.isOrdered == isOrdered;
}

function equalTo(value) {
    return {
        operator: operatorEqualTo,
        operand: value
    };
}

function startsWith(value) {
    return {
        operator: operatorStartsWith,
        operand: value
    };
}

function operatorEqualTo(first, second) {
    return first.toUpperCase() === second.toUpperCase();
}

function operatorStartsWith(first, second) {
    return second.toUpperCase().indexOf(first.toUpperCase()) === 0;
}


/***/ }),

/***/ 72761:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);

var html = __webpack_require__(61754);

exports.topLevelElement = topLevelElement;
exports.elements = elements;
exports.element = element;

function topLevelElement(tagName, attributes) {
    return elements([element(tagName, attributes, {fresh: true})]);
}

function elements(elementStyles) {
    return new HtmlPath(elementStyles.map(function(elementStyle) {
        if (_.isString(elementStyle)) {
            return element(elementStyle);
        } else {
            return elementStyle;
        }
    }));
}

function HtmlPath(elements) {
    this._elements = elements;
}

HtmlPath.prototype.wrap = function wrap(children) {
    var result = children();
    for (var index = this._elements.length - 1; index >= 0; index--) {
        result = this._elements[index].wrapNodes(result);
    }
    return result;
};

function element(tagName, attributes, options) {
    options = options || {};
    return new Element(tagName, attributes, options);
}

function Element(tagName, attributes, options) {
    var tagNames = {};
    if (_.isArray(tagName)) {
        tagName.forEach(function(tagName) {
            tagNames[tagName] = true;
        });
        tagName = tagName[0];
    } else {
        tagNames[tagName] = true;
    }
    
    this.tagName = tagName;
    this.tagNames = tagNames;
    this.attributes = attributes || {};
    this.fresh = options.fresh;
    this.separator = options.separator;
}

Element.prototype.matchesElement = function(element) {
    return this.tagNames[element.tagName] && _.isEqual(this.attributes || {}, element.attributes || {});
};

Element.prototype.wrap = function wrap(generateNodes) {
    return this.wrapNodes(generateNodes());
};

Element.prototype.wrapNodes = function wrapNodes(nodes) {
    return [html.elementWithTag(this, nodes)];
};

exports.empty = elements([]);
exports.ignore = {
    wrap: function() {
        return [];
    }
};


/***/ }),

/***/ 16039:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var lop = __webpack_require__(96324);
var RegexTokeniser = lop.RegexTokeniser;

exports.t = tokenise;

var stringPrefix = "'((?:\\\\.|[^'])*)";

function tokenise(string) {
    var identifierCharacter = "(?:[a-zA-Z\\-_]|\\\\.)";
    var tokeniser = new RegexTokeniser([
        {name: "identifier", regex: new RegExp("(" + identifierCharacter + "(?:" + identifierCharacter + "|[0-9])*)")},
        {name: "dot", regex: /\./},
        {name: "colon", regex: /:/},
        {name: "gt", regex: />/},
        {name: "whitespace", regex: /\s+/},
        {name: "arrow", regex: /=>/},
        {name: "equals", regex: /=/},
        {name: "startsWith", regex: /\^=/},
        {name: "open-paren", regex: /\(/},
        {name: "close-paren", regex: /\)/},
        {name: "open-square-bracket", regex: /\[/},
        {name: "close-square-bracket", regex: /\]/},
        {name: "string", regex: new RegExp(stringPrefix + "'")},
        {name: "unterminated-string", regex: new RegExp(stringPrefix)},
        {name: "integer", regex: /([0-9]+)/},
        {name: "choice", regex: /\|/},
        {name: "bang", regex: /(!)/}
    ]);
    return tokeniser.tokenise(string);
}


/***/ }),

/***/ 54397:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);

exports.paragraph = paragraph;
exports.run = run;
exports._elements = elements;
exports._elementsOfType = elementsOfType;
exports.getDescendantsOfType = getDescendantsOfType;
exports.getDescendants = getDescendants;

function paragraph(transform) {
    return elementsOfType("paragraph", transform);
}

function run(transform) {
    return elementsOfType("run", transform);
}

function elementsOfType(elementType, transform) {
    return elements(function(element) {
        if (element.type === elementType) {
            return transform(element);
        } else {
            return element;
        }
    });
}

function elements(transform) {
    return function transformElement(element) {
        if (element.children) {
            var children = _.map(element.children, transformElement);
            element = _.extend(element, {children: children});
        }
        return transform(element);
    };
}


function getDescendantsOfType(element, type) {
    return getDescendants(element).filter(function(descendant) {
        return descendant.type === type;
    });
}

function getDescendants(element) {
    var descendants = [];

    visitDescendants(element, function(descendant) {
        descendants.push(descendant);
    });

    return descendants;
}

function visitDescendants(element, visit) {
    if (element.children) {
        element.children.forEach(function(child) {
            visitDescendants(child, visit);
            visit(child);
        });
    }
}


/***/ }),

/***/ 40374:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var __webpack_unused_export__;
var htmlPaths = __webpack_require__(72761);
var Html = __webpack_require__(61754);


__webpack_unused_export__ = element;

function element(name) {
    return function(html) {
        return Html.elementWithTag(htmlPaths.element(name), [html]);
    };
}


/***/ }),

/***/ 61889:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);

exports.writer = writer;

function writer(options) {
    options = options || {};
    if (options.prettyPrint) {
        return prettyWriter();
    } else {
        return simpleWriter();
    }
}


var indentedElements = {
    div: true,
    p: true,
    ul: true,
    li: true
};


function prettyWriter() {
    var indentationLevel = 0;
    var indentation = "  ";
    var stack = [];
    var start = true;
    var inText = false;

    var writer = simpleWriter();

    function open(tagName, attributes) {
        if (indentedElements[tagName]) {
            indent();
        }
        stack.push(tagName);
        writer.open(tagName, attributes);
        if (indentedElements[tagName]) {
            indentationLevel++;
        }
        start = false;
    }

    function close(tagName) {
        if (indentedElements[tagName]) {
            indentationLevel--;
            indent();
        }
        stack.pop();
        writer.close(tagName);
    }

    function text(value) {
        startText();
        var text = isInPre() ? value : value.replace("\n", "\n" + indentation);
        writer.text(text);
    }

    function selfClosing(tagName, attributes) {
        indent();
        writer.selfClosing(tagName, attributes);
    }

    function insideIndentedElement() {
        return stack.length === 0 || indentedElements[stack[stack.length - 1]];
    }

    function startText() {
        if (!inText) {
            indent();
            inText = true;
        }
    }

    function indent() {
        inText = false;
        if (!start && insideIndentedElement() && !isInPre()) {
            writer._append("\n");
            for (var i = 0; i < indentationLevel; i++) {
                writer._append(indentation);
            }
        }
    }

    function isInPre() {
        return _.some(stack, function(tagName) {
            return tagName === "pre";
        });
    }

    return {
        asString: writer.asString,
        open: open,
        close: close,
        text: text,
        selfClosing: selfClosing
    };
}


function simpleWriter() {
    var fragments = [];

    function open(tagName, attributes) {
        var attributeString = generateAttributeString(attributes);
        fragments.push("<" + tagName + attributeString + ">");
    }

    function close(tagName) {
        fragments.push("</" + tagName + ">");
    }

    function selfClosing(tagName, attributes) {
        var attributeString = generateAttributeString(attributes);
        fragments.push("<" + tagName + attributeString + " />");
    }

    function generateAttributeString(attributes) {
        return _.map(attributes, function(value, key) {
            return " " + key + '="' + escapeHtmlAttribute(value) + '"';
        }).join("");
    }

    function text(value) {
        fragments.push(escapeHtmlText(value));
    }

    function append(html) {
        fragments.push(html);
    }

    function asString() {
        return fragments.join("");
    }

    return {
        asString: asString,
        open: open,
        close: close,
        text: text,
        selfClosing: selfClosing,
        _append: append
    };
}

function escapeHtmlText(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtmlAttribute(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}


/***/ }),

/***/ 27357:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var htmlWriter = __webpack_require__(61889);
var markdownWriter = __webpack_require__(49622);

exports.writer = writer;


function writer(options) {
    options = options || {};
    if (options.outputFormat === "markdown") {
        return markdownWriter.writer();
    } else {
        return htmlWriter.writer(options);
    }
}


/***/ }),

/***/ 49622:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);


function symmetricMarkdownElement(end) {
    return markdownElement(end, end);
}

function markdownElement(start, end) {
    return function() {
        return {start: start, end: end};
    };
}

function markdownLink(attributes) {
    var href = attributes.href || "";
    if (href) {
        return {
            start: "[",
            end: "](" + href + ")",
            anchorPosition: "before"
        };
    } else {
        return {};
    }
}

function markdownImage(attributes) {
    var src = attributes.src || "";
    var altText = attributes.alt || "";
    if (src || altText) {
        return {start: "![" + altText + "](" + src + ")"};
    } else {
        return {};
    }
}

function markdownList(options) {
    return function(attributes, list) {
        return {
            start: list ? "\n" : "",
            end: list ? "" : "\n",
            list: {
                isOrdered: options.isOrdered,
                indent: list ? list.indent + 1 : 0,
                count: 0
            }
        };
    };
}

function markdownListItem(attributes, list, listItem) {
    list = list || {indent: 0, isOrdered: false, count: 0};
    list.count++;
    listItem.hasClosed = false;
    
    var bullet = list.isOrdered ? list.count + "." : "-";
    var start = repeatString("\t", list.indent) + bullet + " ";
        
    return {
        start: start,
        end: function() {
            if (!listItem.hasClosed) {
                listItem.hasClosed = true;
                return "\n";
            }
        }
    };
}

var htmlToMarkdown = {
    "p": markdownElement("", "\n\n"),
    "br": markdownElement("", "  \n"),
    "ul": markdownList({isOrdered: false}),
    "ol": markdownList({isOrdered: true}),
    "li": markdownListItem,
    "strong": symmetricMarkdownElement("__"),
    "em": symmetricMarkdownElement("*"),
    "a": markdownLink,
    "img": markdownImage
};

(function() {
    for (var i = 1; i <= 6; i++) {
        htmlToMarkdown["h" + i] = markdownElement(repeatString("#", i) + " ", "\n\n");
    }
})();

function repeatString(value, count) {
    return new Array(count + 1).join(value);
}

function markdownWriter() {
    var fragments = [];
    var elementStack = [];
    var list = null;
    var listItem = {};
    
    function open(tagName, attributes) {
        attributes = attributes || {};
        
        var createElement = htmlToMarkdown[tagName] || function() {
            return {};
        };
        var element = createElement(attributes, list, listItem);
        elementStack.push({end: element.end, list: list});
        
        if (element.list) {
            list = element.list;
        }
        
        var anchorBeforeStart = element.anchorPosition === "before";
        if (anchorBeforeStart) {
            writeAnchor(attributes);
        }

        fragments.push(element.start || "");
        if (!anchorBeforeStart) {
            writeAnchor(attributes);
        }
    }
    
    function writeAnchor(attributes) {
        if (attributes.id) {
            fragments.push('<a id="' + attributes.id + '"></a>');
        }
    }
    
    function close(tagName) {
        var element = elementStack.pop();
        list = element.list;
        var end = _.isFunction(element.end) ? element.end() : element.end;
        fragments.push(end || "");
    }
    
    function selfClosing(tagName, attributes) {
        open(tagName, attributes);
        close(tagName);
    }
    
    function text(value) {
        fragments.push(escapeMarkdown(value));
    }
    
    function asString() {
        return fragments.join("");
    }

    return {
        asString: asString,
        open: open,
        close: close,
        text: text,
        selfClosing: selfClosing
    };
}

exports.writer = markdownWriter;

function escapeMarkdown(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/([\`\*_\{\}\[\]\(\)\#\+\-\.\!])/g, '\\$1');
}


/***/ }),

/***/ 38648:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var nodes = __webpack_require__(5581);

exports.Element = nodes.Element;
exports.element = nodes.element;
exports.emptyElement = nodes.emptyElement;
exports.text = nodes.text;
exports.readString = __webpack_require__(64513).readString;
exports.writeString = __webpack_require__(15533).writeString;


/***/ }),

/***/ 5581:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);


exports.Element = Element;
exports.element = function(name, attributes, children) {
    return new Element(name, attributes, children);
};
exports.text = function(value) {
    return {
        type: "text",
        value: value
    };
};


var emptyElement = exports.emptyElement = {
    first: function() {
        return null;
    },
    firstOrEmpty: function() {
        return emptyElement;
    },
    attributes: {},
    children: []
};

function Element(name, attributes, children) {
    this.type = "element";
    this.name = name;
    this.attributes = attributes || {};
    this.children = children || [];
}

Element.prototype.first = function(name) {
    return _.find(this.children, function(child) {
        return child.name === name;
    });
};

Element.prototype.firstOrEmpty = function(name) {
    return this.first(name) || emptyElement;
};

Element.prototype.getElementsByTagName = function(name) {
    var elements = _.filter(this.children, function(child) {
        return child.name === name;
    });
    return toElementList(elements);
};

Element.prototype.text = function() {
    if (this.children.length === 0) {
        return "";
    } else if (this.children.length !== 1 || this.children[0].type !== "text") {
        throw new Error("Not implemented");
    }
    return this.children[0].value;
};

var elementListPrototype = {
    getElementsByTagName: function(name) {
        return toElementList(_.flatten(this.map(function(element) {
            return element.getElementsByTagName(name);
        }, true)));
    }
};

function toElementList(array) {
    return _.extend(array, elementListPrototype);
}


/***/ }),

/***/ 64513:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var promises = __webpack_require__(45818);
var _ = __webpack_require__(4523);

var xmldom = __webpack_require__(89525);
var nodes = __webpack_require__(5581);
var Element = nodes.Element;

exports.readString = readString;

var Node = xmldom.Node;

function readString(xmlString, namespaceMap) {
    namespaceMap = namespaceMap || {};

    try {
        var document = xmldom.parseFromString(xmlString, "text/xml");
    } catch (error) {
        return promises.reject(error);
    }

    if (document.documentElement.tagName === "parsererror") {
        return promises.resolve(new Error(document.documentElement.textContent));
    }

    function convertNode(node) {
        switch (node.nodeType) {
        case Node.ELEMENT_NODE:
            return convertElement(node);
        case Node.TEXT_NODE:
            return nodes.text(node.nodeValue);
        }
    }

    function convertElement(element) {
        var convertedName = convertName(element);

        var convertedChildren = [];
        _.forEach(element.childNodes, function(childNode) {
            var convertedNode = convertNode(childNode);
            if (convertedNode) {
                convertedChildren.push(convertedNode);
            }
        });

        var convertedAttributes = {};
        _.forEach(element.attributes, function(attribute) {
            convertedAttributes[convertName(attribute)] = attribute.value;
        });

        return new Element(convertedName, convertedAttributes, convertedChildren);
    }

    function convertName(node) {
        if (node.namespaceURI) {
            var mappedPrefix = namespaceMap[node.namespaceURI];
            var prefix;
            if (mappedPrefix) {
                prefix = mappedPrefix + ":";
            } else {
                prefix = "{" + node.namespaceURI + "}";
            }
            return prefix + node.localName;
        } else {
            return node.localName;
        }
    }

    return promises.resolve(convertNode(document.documentElement));
}


/***/ }),

/***/ 15533:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var _ = __webpack_require__(4523);
var xmlbuilder = __webpack_require__(59665);


exports.writeString = writeString;


function writeString(root, namespaces) {
    var uriToPrefix = _.invert(namespaces);
    
    var nodeWriters = {
        element: writeElement,
        text: writeTextNode
    };

    function writeNode(builder, node) {
        return nodeWriters[node.type](builder, node);
    }

    function writeElement(builder, element) {
        var elementBuilder = builder.element(mapElementName(element.name), element.attributes);
        element.children.forEach(function(child) {
            writeNode(elementBuilder, child);
        });
    }
    
    function mapElementName(name) {
        var longFormMatch = /^\{(.*)\}(.*)$/.exec(name);
        if (longFormMatch) {
            var prefix = uriToPrefix[longFormMatch[1]];
            return prefix + (prefix === "" ? "" : ":") + longFormMatch[2];
        } else {
            return name;
        }
    }
    
    function writeDocument(root) {
        var builder = xmlbuilder
            .create(mapElementName(root.name), {
                version: '1.0',
                encoding: 'UTF-8',
                standalone: true
            });
        
        _.forEach(namespaces, function(uri, prefix) {
            var key = "xmlns" + (prefix === "" ? "" : ":" + prefix);
            builder.attribute(key, uri);
        });
        
        root.children.forEach(function(child) {
            writeNode(builder, child);
        });
        return builder.end();
    }

    return writeDocument(root);
}

function writeTextNode(builder, node) {
    builder.text(node.value);
}


/***/ }),

/***/ 89525:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var xmldom = __webpack_require__(28978);
var dom = __webpack_require__(84722);

function parseFromString(string) {
    var error = null;

    var domParser = new xmldom.DOMParser({
        errorHandler: function(level, message) {
            error = {level: level, message: message};
        }
    });

    var document = domParser.parseFromString(string);

    if (error === null) {
        return document;
    } else {
        throw new Error(error.level + ": " + error.message);
    }
}

exports.parseFromString = parseFromString;
exports.Node = dom.Node;


/***/ }),

/***/ 27227:
/***/ (function(__unused_webpack_module, exports, __webpack_require__) {

var base64js = __webpack_require__(67526);
var JSZip = __webpack_require__(71710);

exports.openArrayBuffer = openArrayBuffer;
exports.splitPath = splitPath;
exports.joinPath = joinPath;

function openArrayBuffer(arrayBuffer) {
    return JSZip.loadAsync(arrayBuffer).then(function(zipFile) {
        function exists(name) {
            return zipFile.file(name) !== null;
        }

        function read(name, encoding) {
            return zipFile.file(name).async("uint8array").then(function(array) {
                if (encoding === "base64") {
                    return base64js.fromByteArray(array);
                } else if (encoding) {
                    var decoder = new TextDecoder(encoding);
                    return decoder.decode(array);
                } else {
                    return array;
                }
            });
        }

        function write(name, contents) {
            zipFile.file(name, contents);
        }

        function toArrayBuffer() {
            return zipFile.generateAsync({type: "arraybuffer"});
        }

        return {
            exists: exists,
            read: read,
            write: write,
            toArrayBuffer: toArrayBuffer
        };
    });
}

function splitPath(path) {
    var lastIndex = path.lastIndexOf("/");
    if (lastIndex === -1) {
        return {dirname: "", basename: path};
    } else {
        return {
            dirname: path.substring(0, lastIndex),
            basename: path.substring(lastIndex + 1)
        };
    }
}

function joinPath() {
    var nonEmptyPaths = Array.prototype.filter.call(arguments, function(path) {
        return path;
    });

    var relevantPaths = [];

    nonEmptyPaths.forEach(function(path) {
        if (/^\//.test(path)) {
            relevantPaths = [path];
        } else {
            relevantPaths.push(path);
        }
    });

    return relevantPaths.join("/");
}


/***/ }),

/***/ 97605:
/***/ (function(module) {

"use strict";

module.exports = function(Promise) {
var SomePromiseArray = Promise._SomePromiseArray;
function any(promises) {
    var ret = new SomePromiseArray(promises);
    var promise = ret.promise();
    ret.setHowMany(1);
    ret.setUnwrap();
    ret.init();
    return promise;
}

Promise.any = function (promises) {
    return any(promises);
};

Promise.prototype.any = function () {
    return any(this);
};

};


/***/ }),

/***/ 47283:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var firstLineError;
try {throw new Error(); } catch (e) {firstLineError = e;}
var schedule = __webpack_require__(60462);
var Queue = __webpack_require__(63564);
var util = __webpack_require__(95427);

function Async() {
    this._customScheduler = false;
    this._isTickUsed = false;
    this._lateQueue = new Queue(16);
    this._normalQueue = new Queue(16);
    this._haveDrainedQueues = false;
    this._trampolineEnabled = true;
    var self = this;
    this.drainQueues = function () {
        self._drainQueues();
    };
    this._schedule = schedule;
}

Async.prototype.setScheduler = function(fn) {
    var prev = this._schedule;
    this._schedule = fn;
    this._customScheduler = true;
    return prev;
};

Async.prototype.hasCustomScheduler = function() {
    return this._customScheduler;
};

Async.prototype.enableTrampoline = function() {
    this._trampolineEnabled = true;
};

Async.prototype.disableTrampolineIfNecessary = function() {
    if (util.hasDevTools) {
        this._trampolineEnabled = false;
    }
};

Async.prototype.haveItemsQueued = function () {
    return this._isTickUsed || this._haveDrainedQueues;
};


Async.prototype.fatalError = function(e, isNode) {
    if (isNode) {
        process.stderr.write("Fatal " + (e instanceof Error ? e.stack : e) +
            "\n");
        process.exit(2);
    } else {
        this.throwLater(e);
    }
};

Async.prototype.throwLater = function(fn, arg) {
    if (arguments.length === 1) {
        arg = fn;
        fn = function () { throw arg; };
    }
    if (typeof setTimeout !== "undefined") {
        setTimeout(function() {
            fn(arg);
        }, 0);
    } else try {
        this._schedule(function() {
            fn(arg);
        });
    } catch (e) {
        throw new Error("No async scheduler available\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
};

function AsyncInvokeLater(fn, receiver, arg) {
    this._lateQueue.push(fn, receiver, arg);
    this._queueTick();
}

function AsyncInvoke(fn, receiver, arg) {
    this._normalQueue.push(fn, receiver, arg);
    this._queueTick();
}

function AsyncSettlePromises(promise) {
    this._normalQueue._pushOne(promise);
    this._queueTick();
}

if (!util.hasDevTools) {
    Async.prototype.invokeLater = AsyncInvokeLater;
    Async.prototype.invoke = AsyncInvoke;
    Async.prototype.settlePromises = AsyncSettlePromises;
} else {
    Async.prototype.invokeLater = function (fn, receiver, arg) {
        if (this._trampolineEnabled) {
            AsyncInvokeLater.call(this, fn, receiver, arg);
        } else {
            this._schedule(function() {
                setTimeout(function() {
                    fn.call(receiver, arg);
                }, 100);
            });
        }
    };

    Async.prototype.invoke = function (fn, receiver, arg) {
        if (this._trampolineEnabled) {
            AsyncInvoke.call(this, fn, receiver, arg);
        } else {
            this._schedule(function() {
                fn.call(receiver, arg);
            });
        }
    };

    Async.prototype.settlePromises = function(promise) {
        if (this._trampolineEnabled) {
            AsyncSettlePromises.call(this, promise);
        } else {
            this._schedule(function() {
                promise._settlePromises();
            });
        }
    };
}

Async.prototype._drainQueue = function(queue) {
    while (queue.length() > 0) {
        var fn = queue.shift();
        if (typeof fn !== "function") {
            fn._settlePromises();
            continue;
        }
        var receiver = queue.shift();
        var arg = queue.shift();
        fn.call(receiver, arg);
    }
};

Async.prototype._drainQueues = function () {
    this._drainQueue(this._normalQueue);
    this._reset();
    this._haveDrainedQueues = true;
    this._drainQueue(this._lateQueue);
};

Async.prototype._queueTick = function () {
    if (!this._isTickUsed) {
        this._isTickUsed = true;
        this._schedule(this.drainQueues);
    }
};

Async.prototype._reset = function () {
    this._isTickUsed = false;
};

module.exports = Async;
module.exports.firstLineError = firstLineError;


/***/ }),

/***/ 52124:
/***/ (function(module) {

"use strict";

module.exports = function(Promise, INTERNAL, tryConvertToPromise, debug) {
var calledBind = false;
var rejectThis = function(_, e) {
    this._reject(e);
};

var targetRejected = function(e, context) {
    context.promiseRejectionQueued = true;
    context.bindingPromise._then(rejectThis, rejectThis, null, this, e);
};

var bindingResolved = function(thisArg, context) {
    if (((this._bitField & 50397184) === 0)) {
        this._resolveCallback(context.target);
    }
};

var bindingRejected = function(e, context) {
    if (!context.promiseRejectionQueued) this._reject(e);
};

Promise.prototype.bind = function (thisArg) {
    if (!calledBind) {
        calledBind = true;
        Promise.prototype._propagateFrom = debug.propagateFromFunction();
        Promise.prototype._boundValue = debug.boundValueFunction();
    }
    var maybePromise = tryConvertToPromise(thisArg);
    var ret = new Promise(INTERNAL);
    ret._propagateFrom(this, 1);
    var target = this._target();
    ret._setBoundTo(maybePromise);
    if (maybePromise instanceof Promise) {
        var context = {
            promiseRejectionQueued: false,
            promise: ret,
            target: target,
            bindingPromise: maybePromise
        };
        target._then(INTERNAL, targetRejected, undefined, ret, context);
        maybePromise._then(
            bindingResolved, bindingRejected, undefined, ret, context);
        ret._setOnCancel(maybePromise);
    } else {
        ret._resolveCallback(target);
    }
    return ret;
};

Promise.prototype._setBoundTo = function (obj) {
    if (obj !== undefined) {
        this._bitField = this._bitField | 2097152;
        this._boundTo = obj;
    } else {
        this._bitField = this._bitField & (~2097152);
    }
};

Promise.prototype._isBound = function () {
    return (this._bitField & 2097152) === 2097152;
};

Promise.bind = function (thisArg, value) {
    return Promise.resolve(value).bind(thisArg);
};
};


/***/ }),

/***/ 90196:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var cr = Object.create;
if (cr) {
    var callerCache = cr(null);
    var getterCache = cr(null);
    callerCache[" size"] = getterCache[" size"] = 0;
}

module.exports = function(Promise) {
var util = __webpack_require__(95427);
var canEvaluate = util.canEvaluate;
var isIdentifier = util.isIdentifier;

var getMethodCaller;
var getGetter;
if (true) {
var makeMethodCaller = function (methodName) {
    return new Function("ensureMethod", "                                    \n\
        return function(obj) {                                               \n\
            'use strict'                                                     \n\
            var len = this.length;                                           \n\
            ensureMethod(obj, 'methodName');                                 \n\
            switch(len) {                                                    \n\
                case 1: return obj.methodName(this[0]);                      \n\
                case 2: return obj.methodName(this[0], this[1]);             \n\
                case 3: return obj.methodName(this[0], this[1], this[2]);    \n\
                case 0: return obj.methodName();                             \n\
                default:                                                     \n\
                    return obj.methodName.apply(obj, this);                  \n\
            }                                                                \n\
        };                                                                   \n\
        ".replace(/methodName/g, methodName))(ensureMethod);
};

var makeGetter = function (propertyName) {
    return new Function("obj", "                                             \n\
        'use strict';                                                        \n\
        return obj.propertyName;                                             \n\
        ".replace("propertyName", propertyName));
};

var getCompiled = function(name, compiler, cache) {
    var ret = cache[name];
    if (typeof ret !== "function") {
        if (!isIdentifier(name)) {
            return null;
        }
        ret = compiler(name);
        cache[name] = ret;
        cache[" size"]++;
        if (cache[" size"] > 512) {
            var keys = Object.keys(cache);
            for (var i = 0; i < 256; ++i) delete cache[keys[i]];
            cache[" size"] = keys.length - 256;
        }
    }
    return ret;
};

getMethodCaller = function(name) {
    return getCompiled(name, makeMethodCaller, callerCache);
};

getGetter = function(name) {
    return getCompiled(name, makeGetter, getterCache);
};
}

function ensureMethod(obj, methodName) {
    var fn;
    if (obj != null) fn = obj[methodName];
    if (typeof fn !== "function") {
        var message = "Object " + util.classString(obj) + " has no method '" +
            util.toString(methodName) + "'";
        throw new Promise.TypeError(message);
    }
    return fn;
}

function caller(obj) {
    var methodName = this.pop();
    var fn = ensureMethod(obj, methodName);
    return fn.apply(obj, this);
}
Promise.prototype.call = function (methodName) {
    var $_len = arguments.length;var args = new Array(Math.max($_len - 1, 0)); for(var $_i = 1; $_i < $_len; ++$_i) {args[$_i - 1] = arguments[$_i];};
    if (true) {
        if (canEvaluate) {
            var maybeCaller = getMethodCaller(methodName);
            if (maybeCaller !== null) {
                return this._then(
                    maybeCaller, undefined, undefined, args, undefined);
            }
        }
    }
    args.push(methodName);
    return this._then(caller, undefined, undefined, args, undefined);
};

function namedGetter(obj) {
    return obj[this];
}
function indexedGetter(obj) {
    var index = +this;
    if (index < 0) index = Math.max(0, index + obj.length);
    return obj[index];
}
Promise.prototype.get = function (propertyName) {
    var isIndex = (typeof propertyName === "number");
    var getter;
    if (!isIndex) {
        if (canEvaluate) {
            var maybeGetter = getGetter(propertyName);
            getter = maybeGetter !== null ? maybeGetter : namedGetter;
        } else {
            getter = namedGetter;
        }
    } else {
        getter = indexedGetter;
    }
    return this._then(getter, undefined, undefined, propertyName, undefined);
};
};


/***/ }),

/***/ 87357:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise, PromiseArray, apiRejection, debug) {
var util = __webpack_require__(95427);
var tryCatch = util.tryCatch;
var errorObj = util.errorObj;
var async = Promise._async;

Promise.prototype["break"] = Promise.prototype.cancel = function() {
    if (!debug.cancellation()) return this._warn("cancellation is disabled");

    var promise = this;
    var child = promise;
    while (promise._isCancellable()) {
        if (!promise._cancelBy(child)) {
            if (child._isFollowing()) {
                child._followee().cancel();
            } else {
                child._cancelBranched();
            }
            break;
        }

        var parent = promise._cancellationParent;
        if (parent == null || !parent._isCancellable()) {
            if (promise._isFollowing()) {
                promise._followee().cancel();
            } else {
                promise._cancelBranched();
            }
            break;
        } else {
            if (promise._isFollowing()) promise._followee().cancel();
            promise._setWillBeCancelled();
            child = promise;
            promise = parent;
        }
    }
};

Promise.prototype._branchHasCancelled = function() {
    this._branchesRemainingToCancel--;
};

Promise.prototype._enoughBranchesHaveCancelled = function() {
    return this._branchesRemainingToCancel === undefined ||
           this._branchesRemainingToCancel <= 0;
};

Promise.prototype._cancelBy = function(canceller) {
    if (canceller === this) {
        this._branchesRemainingToCancel = 0;
        this._invokeOnCancel();
        return true;
    } else {
        this._branchHasCancelled();
        if (this._enoughBranchesHaveCancelled()) {
            this._invokeOnCancel();
            return true;
        }
    }
    return false;
};

Promise.prototype._cancelBranched = function() {
    if (this._enoughBranchesHaveCancelled()) {
        this._cancel();
    }
};

Promise.prototype._cancel = function() {
    if (!this._isCancellable()) return;
    this._setCancelled();
    async.invoke(this._cancelPromises, this, undefined);
};

Promise.prototype._cancelPromises = function() {
    if (this._length() > 0) this._settlePromises();
};

Promise.prototype._unsetOnCancel = function() {
    this._onCancelField = undefined;
};

Promise.prototype._isCancellable = function() {
    return this.isPending() && !this._isCancelled();
};

Promise.prototype.isCancellable = function() {
    return this.isPending() && !this.isCancelled();
};

Promise.prototype._doInvokeOnCancel = function(onCancelCallback, internalOnly) {
    if (util.isArray(onCancelCallback)) {
        for (var i = 0; i < onCancelCallback.length; ++i) {
            this._doInvokeOnCancel(onCancelCallback[i], internalOnly);
        }
    } else if (onCancelCallback !== undefined) {
        if (typeof onCancelCallback === "function") {
            if (!internalOnly) {
                var e = tryCatch(onCancelCallback).call(this._boundValue());
                if (e === errorObj) {
                    this._attachExtraTrace(e.e);
                    async.throwLater(e.e);
                }
            }
        } else {
            onCancelCallback._resultCancelled(this);
        }
    }
};

Promise.prototype._invokeOnCancel = function() {
    var onCancelCallback = this._onCancel();
    this._unsetOnCancel();
    async.invoke(this._doInvokeOnCancel, this, onCancelCallback);
};

Promise.prototype._invokeInternalOnCancel = function() {
    if (this._isCancellable()) {
        this._doInvokeOnCancel(this._onCancel(), true);
        this._unsetOnCancel();
    }
};

Promise.prototype._resultCancelled = function() {
    this.cancel();
};

};


/***/ }),

/***/ 38021:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(NEXT_FILTER) {
var util = __webpack_require__(95427);
var getKeys = (__webpack_require__(28760).keys);
var tryCatch = util.tryCatch;
var errorObj = util.errorObj;

function catchFilter(instances, cb, promise) {
    return function(e) {
        var boundTo = promise._boundValue();
        predicateLoop: for (var i = 0; i < instances.length; ++i) {
            var item = instances[i];

            if (item === Error ||
                (item != null && item.prototype instanceof Error)) {
                if (e instanceof item) {
                    return tryCatch(cb).call(boundTo, e);
                }
            } else if (typeof item === "function") {
                var matchesPredicate = tryCatch(item).call(boundTo, e);
                if (matchesPredicate === errorObj) {
                    return matchesPredicate;
                } else if (matchesPredicate) {
                    return tryCatch(cb).call(boundTo, e);
                }
            } else if (util.isObject(e)) {
                var keys = getKeys(item);
                for (var j = 0; j < keys.length; ++j) {
                    var key = keys[j];
                    if (item[key] != e[key]) {
                        continue predicateLoop;
                    }
                }
                return tryCatch(cb).call(boundTo, e);
            }
        }
        return NEXT_FILTER;
    };
}

return catchFilter;
};


/***/ }),

/***/ 49232:
/***/ (function(module) {

"use strict";

module.exports = function(Promise) {
var longStackTraces = false;
var contextStack = [];

Promise.prototype._promiseCreated = function() {};
Promise.prototype._pushContext = function() {};
Promise.prototype._popContext = function() {return null;};
Promise._peekContext = Promise.prototype._peekContext = function() {};

function Context() {
    this._trace = new Context.CapturedTrace(peekContext());
}
Context.prototype._pushContext = function () {
    if (this._trace !== undefined) {
        this._trace._promiseCreated = null;
        contextStack.push(this._trace);
    }
};

Context.prototype._popContext = function () {
    if (this._trace !== undefined) {
        var trace = contextStack.pop();
        var ret = trace._promiseCreated;
        trace._promiseCreated = null;
        return ret;
    }
    return null;
};

function createContext() {
    if (longStackTraces) return new Context();
}

function peekContext() {
    var lastIndex = contextStack.length - 1;
    if (lastIndex >= 0) {
        return contextStack[lastIndex];
    }
    return undefined;
}
Context.CapturedTrace = null;
Context.create = createContext;
Context.deactivateLongStackTraces = function() {};
Context.activateLongStackTraces = function() {
    var Promise_pushContext = Promise.prototype._pushContext;
    var Promise_popContext = Promise.prototype._popContext;
    var Promise_PeekContext = Promise._peekContext;
    var Promise_peekContext = Promise.prototype._peekContext;
    var Promise_promiseCreated = Promise.prototype._promiseCreated;
    Context.deactivateLongStackTraces = function() {
        Promise.prototype._pushContext = Promise_pushContext;
        Promise.prototype._popContext = Promise_popContext;
        Promise._peekContext = Promise_PeekContext;
        Promise.prototype._peekContext = Promise_peekContext;
        Promise.prototype._promiseCreated = Promise_promiseCreated;
        longStackTraces = false;
    };
    longStackTraces = true;
    Promise.prototype._pushContext = Context.prototype._pushContext;
    Promise.prototype._popContext = Context.prototype._popContext;
    Promise._peekContext = Promise.prototype._peekContext = peekContext;
    Promise.prototype._promiseCreated = function() {
        var ctx = this._peekContext();
        if (ctx && ctx._promiseCreated == null) ctx._promiseCreated = this;
    };
};
return Context;
};


/***/ }),

/***/ 29833:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise, Context) {
var getDomain = Promise._getDomain;
var async = Promise._async;
var Warning = (__webpack_require__(23828).Warning);
var util = __webpack_require__(95427);
var canAttachTrace = util.canAttachTrace;
var unhandledRejectionHandled;
var possiblyUnhandledRejection;
var bluebirdFramePattern =
    /[\\\/]bluebird[\\\/]js[\\\/](release|debug|instrumented)/;
var nodeFramePattern = /\((?:timers\.js):\d+:\d+\)/;
var parseLinePattern = /[\/<\(](.+?):(\d+):(\d+)\)?\s*$/;
var stackFramePattern = null;
var formatStack = null;
var indentStackFrames = false;
var printWarning;
var debugging = !!(util.env("BLUEBIRD_DEBUG") != 0 &&
                        ( false ||
                         util.env("BLUEBIRD_DEBUG") ||
                         util.env("NODE_ENV") === "development"));

var warnings = !!(util.env("BLUEBIRD_WARNINGS") != 0 &&
    (debugging || util.env("BLUEBIRD_WARNINGS")));

var longStackTraces = !!(util.env("BLUEBIRD_LONG_STACK_TRACES") != 0 &&
    (debugging || util.env("BLUEBIRD_LONG_STACK_TRACES")));

var wForgottenReturn = util.env("BLUEBIRD_W_FORGOTTEN_RETURN") != 0 &&
    (warnings || !!util.env("BLUEBIRD_W_FORGOTTEN_RETURN"));

Promise.prototype.suppressUnhandledRejections = function() {
    var target = this._target();
    target._bitField = ((target._bitField & (~1048576)) |
                      524288);
};

Promise.prototype._ensurePossibleRejectionHandled = function () {
    if ((this._bitField & 524288) !== 0) return;
    this._setRejectionIsUnhandled();
    async.invokeLater(this._notifyUnhandledRejection, this, undefined);
};

Promise.prototype._notifyUnhandledRejectionIsHandled = function () {
    fireRejectionEvent("rejectionHandled",
                                  unhandledRejectionHandled, undefined, this);
};

Promise.prototype._setReturnedNonUndefined = function() {
    this._bitField = this._bitField | 268435456;
};

Promise.prototype._returnedNonUndefined = function() {
    return (this._bitField & 268435456) !== 0;
};

Promise.prototype._notifyUnhandledRejection = function () {
    if (this._isRejectionUnhandled()) {
        var reason = this._settledValue();
        this._setUnhandledRejectionIsNotified();
        fireRejectionEvent("unhandledRejection",
                                      possiblyUnhandledRejection, reason, this);
    }
};

Promise.prototype._setUnhandledRejectionIsNotified = function () {
    this._bitField = this._bitField | 262144;
};

Promise.prototype._unsetUnhandledRejectionIsNotified = function () {
    this._bitField = this._bitField & (~262144);
};

Promise.prototype._isUnhandledRejectionNotified = function () {
    return (this._bitField & 262144) > 0;
};

Promise.prototype._setRejectionIsUnhandled = function () {
    this._bitField = this._bitField | 1048576;
};

Promise.prototype._unsetRejectionIsUnhandled = function () {
    this._bitField = this._bitField & (~1048576);
    if (this._isUnhandledRejectionNotified()) {
        this._unsetUnhandledRejectionIsNotified();
        this._notifyUnhandledRejectionIsHandled();
    }
};

Promise.prototype._isRejectionUnhandled = function () {
    return (this._bitField & 1048576) > 0;
};

Promise.prototype._warn = function(message, shouldUseOwnTrace, promise) {
    return warn(message, shouldUseOwnTrace, promise || this);
};

Promise.onPossiblyUnhandledRejection = function (fn) {
    var domain = getDomain();
    possiblyUnhandledRejection =
        typeof fn === "function" ? (domain === null ?
                                            fn : util.domainBind(domain, fn))
                                 : undefined;
};

Promise.onUnhandledRejectionHandled = function (fn) {
    var domain = getDomain();
    unhandledRejectionHandled =
        typeof fn === "function" ? (domain === null ?
                                            fn : util.domainBind(domain, fn))
                                 : undefined;
};

var disableLongStackTraces = function() {};
Promise.longStackTraces = function () {
    if (async.haveItemsQueued() && !config.longStackTraces) {
        throw new Error("cannot enable long stack traces after promises have been created\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    if (!config.longStackTraces && longStackTracesIsSupported()) {
        var Promise_captureStackTrace = Promise.prototype._captureStackTrace;
        var Promise_attachExtraTrace = Promise.prototype._attachExtraTrace;
        config.longStackTraces = true;
        disableLongStackTraces = function() {
            if (async.haveItemsQueued() && !config.longStackTraces) {
                throw new Error("cannot enable long stack traces after promises have been created\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
            }
            Promise.prototype._captureStackTrace = Promise_captureStackTrace;
            Promise.prototype._attachExtraTrace = Promise_attachExtraTrace;
            Context.deactivateLongStackTraces();
            async.enableTrampoline();
            config.longStackTraces = false;
        };
        Promise.prototype._captureStackTrace = longStackTracesCaptureStackTrace;
        Promise.prototype._attachExtraTrace = longStackTracesAttachExtraTrace;
        Context.activateLongStackTraces();
        async.disableTrampolineIfNecessary();
    }
};

Promise.hasLongStackTraces = function () {
    return config.longStackTraces && longStackTracesIsSupported();
};

var fireDomEvent = (function() {
    try {
        if (typeof CustomEvent === "function") {
            var event = new CustomEvent("CustomEvent");
            util.global.dispatchEvent(event);
            return function(name, event) {
                var domEvent = new CustomEvent(name.toLowerCase(), {
                    detail: event,
                    cancelable: true
                });
                return !util.global.dispatchEvent(domEvent);
            };
        } else if (typeof Event === "function") {
            var event = new Event("CustomEvent");
            util.global.dispatchEvent(event);
            return function(name, event) {
                var domEvent = new Event(name.toLowerCase(), {
                    cancelable: true
                });
                domEvent.detail = event;
                return !util.global.dispatchEvent(domEvent);
            };
        } else {
            var event = document.createEvent("CustomEvent");
            event.initCustomEvent("testingtheevent", false, true, {});
            util.global.dispatchEvent(event);
            return function(name, event) {
                var domEvent = document.createEvent("CustomEvent");
                domEvent.initCustomEvent(name.toLowerCase(), false, true,
                    event);
                return !util.global.dispatchEvent(domEvent);
            };
        }
    } catch (e) {}
    return function() {
        return false;
    };
})();

var fireGlobalEvent = (function() {
    if (util.isNode) {
        return function() {
            return process.emit.apply(process, arguments);
        };
    } else {
        if (!util.global) {
            return function() {
                return false;
            };
        }
        return function(name) {
            var methodName = "on" + name.toLowerCase();
            var method = util.global[methodName];
            if (!method) return false;
            method.apply(util.global, [].slice.call(arguments, 1));
            return true;
        };
    }
})();

function generatePromiseLifecycleEventObject(name, promise) {
    return {promise: promise};
}

var eventToObjectGenerator = {
    promiseCreated: generatePromiseLifecycleEventObject,
    promiseFulfilled: generatePromiseLifecycleEventObject,
    promiseRejected: generatePromiseLifecycleEventObject,
    promiseResolved: generatePromiseLifecycleEventObject,
    promiseCancelled: generatePromiseLifecycleEventObject,
    promiseChained: function(name, promise, child) {
        return {promise: promise, child: child};
    },
    warning: function(name, warning) {
        return {warning: warning};
    },
    unhandledRejection: function (name, reason, promise) {
        return {reason: reason, promise: promise};
    },
    rejectionHandled: generatePromiseLifecycleEventObject
};

var activeFireEvent = function (name) {
    var globalEventFired = false;
    try {
        globalEventFired = fireGlobalEvent.apply(null, arguments);
    } catch (e) {
        async.throwLater(e);
        globalEventFired = true;
    }

    var domEventFired = false;
    try {
        domEventFired = fireDomEvent(name,
                    eventToObjectGenerator[name].apply(null, arguments));
    } catch (e) {
        async.throwLater(e);
        domEventFired = true;
    }

    return domEventFired || globalEventFired;
};

Promise.config = function(opts) {
    opts = Object(opts);
    if ("longStackTraces" in opts) {
        if (opts.longStackTraces) {
            Promise.longStackTraces();
        } else if (!opts.longStackTraces && Promise.hasLongStackTraces()) {
            disableLongStackTraces();
        }
    }
    if ("warnings" in opts) {
        var warningsOption = opts.warnings;
        config.warnings = !!warningsOption;
        wForgottenReturn = config.warnings;

        if (util.isObject(warningsOption)) {
            if ("wForgottenReturn" in warningsOption) {
                wForgottenReturn = !!warningsOption.wForgottenReturn;
            }
        }
    }
    if ("cancellation" in opts && opts.cancellation && !config.cancellation) {
        if (async.haveItemsQueued()) {
            throw new Error(
                "cannot enable cancellation after promises are in use");
        }
        Promise.prototype._clearCancellationData =
            cancellationClearCancellationData;
        Promise.prototype._propagateFrom = cancellationPropagateFrom;
        Promise.prototype._onCancel = cancellationOnCancel;
        Promise.prototype._setOnCancel = cancellationSetOnCancel;
        Promise.prototype._attachCancellationCallback =
            cancellationAttachCancellationCallback;
        Promise.prototype._execute = cancellationExecute;
        propagateFromFunction = cancellationPropagateFrom;
        config.cancellation = true;
    }
    if ("monitoring" in opts) {
        if (opts.monitoring && !config.monitoring) {
            config.monitoring = true;
            Promise.prototype._fireEvent = activeFireEvent;
        } else if (!opts.monitoring && config.monitoring) {
            config.monitoring = false;
            Promise.prototype._fireEvent = defaultFireEvent;
        }
    }
    return Promise;
};

function defaultFireEvent() { return false; }

Promise.prototype._fireEvent = defaultFireEvent;
Promise.prototype._execute = function(executor, resolve, reject) {
    try {
        executor(resolve, reject);
    } catch (e) {
        return e;
    }
};
Promise.prototype._onCancel = function () {};
Promise.prototype._setOnCancel = function (handler) { ; };
Promise.prototype._attachCancellationCallback = function(onCancel) {
    ;
};
Promise.prototype._captureStackTrace = function () {};
Promise.prototype._attachExtraTrace = function () {};
Promise.prototype._clearCancellationData = function() {};
Promise.prototype._propagateFrom = function (parent, flags) {
    ;
    ;
};

function cancellationExecute(executor, resolve, reject) {
    var promise = this;
    try {
        executor(resolve, reject, function(onCancel) {
            if (typeof onCancel !== "function") {
                throw new TypeError("onCancel must be a function, got: " +
                                    util.toString(onCancel));
            }
            promise._attachCancellationCallback(onCancel);
        });
    } catch (e) {
        return e;
    }
}

function cancellationAttachCancellationCallback(onCancel) {
    if (!this._isCancellable()) return this;

    var previousOnCancel = this._onCancel();
    if (previousOnCancel !== undefined) {
        if (util.isArray(previousOnCancel)) {
            previousOnCancel.push(onCancel);
        } else {
            this._setOnCancel([previousOnCancel, onCancel]);
        }
    } else {
        this._setOnCancel(onCancel);
    }
}

function cancellationOnCancel() {
    return this._onCancelField;
}

function cancellationSetOnCancel(onCancel) {
    this._onCancelField = onCancel;
}

function cancellationClearCancellationData() {
    this._cancellationParent = undefined;
    this._onCancelField = undefined;
}

function cancellationPropagateFrom(parent, flags) {
    if ((flags & 1) !== 0) {
        this._cancellationParent = parent;
        var branchesRemainingToCancel = parent._branchesRemainingToCancel;
        if (branchesRemainingToCancel === undefined) {
            branchesRemainingToCancel = 0;
        }
        parent._branchesRemainingToCancel = branchesRemainingToCancel + 1;
    }
    if ((flags & 2) !== 0 && parent._isBound()) {
        this._setBoundTo(parent._boundTo);
    }
}

function bindingPropagateFrom(parent, flags) {
    if ((flags & 2) !== 0 && parent._isBound()) {
        this._setBoundTo(parent._boundTo);
    }
}
var propagateFromFunction = bindingPropagateFrom;

function boundValueFunction() {
    var ret = this._boundTo;
    if (ret !== undefined) {
        if (ret instanceof Promise) {
            if (ret.isFulfilled()) {
                return ret.value();
            } else {
                return undefined;
            }
        }
    }
    return ret;
}

function longStackTracesCaptureStackTrace() {
    this._trace = new CapturedTrace(this._peekContext());
}

function longStackTracesAttachExtraTrace(error, ignoreSelf) {
    if (canAttachTrace(error)) {
        var trace = this._trace;
        if (trace !== undefined) {
            if (ignoreSelf) trace = trace._parent;
        }
        if (trace !== undefined) {
            trace.attachExtraTrace(error);
        } else if (!error.__stackCleaned__) {
            var parsed = parseStackAndMessage(error);
            util.notEnumerableProp(error, "stack",
                parsed.message + "\n" + parsed.stack.join("\n"));
            util.notEnumerableProp(error, "__stackCleaned__", true);
        }
    }
}

function checkForgottenReturns(returnValue, promiseCreated, name, promise,
                               parent) {
    if (returnValue === undefined && promiseCreated !== null &&
        wForgottenReturn) {
        if (parent !== undefined && parent._returnedNonUndefined()) return;
        if ((promise._bitField & 65535) === 0) return;

        if (name) name = name + " ";
        var handlerLine = "";
        var creatorLine = "";
        if (promiseCreated._trace) {
            var traceLines = promiseCreated._trace.stack.split("\n");
            var stack = cleanStack(traceLines);
            for (var i = stack.length - 1; i >= 0; --i) {
                var line = stack[i];
                if (!nodeFramePattern.test(line)) {
                    var lineMatches = line.match(parseLinePattern);
                    if (lineMatches) {
                        handlerLine  = "at " + lineMatches[1] +
                            ":" + lineMatches[2] + ":" + lineMatches[3] + " ";
                    }
                    break;
                }
            }

            if (stack.length > 0) {
                var firstUserLine = stack[0];
                for (var i = 0; i < traceLines.length; ++i) {

                    if (traceLines[i] === firstUserLine) {
                        if (i > 0) {
                            creatorLine = "\n" + traceLines[i - 1];
                        }
                        break;
                    }
                }

            }
        }
        var msg = "a promise was created in a " + name +
            "handler " + handlerLine + "but was not returned from it, " +
            "see http://goo.gl/rRqMUw" +
            creatorLine;
        promise._warn(msg, true, promiseCreated);
    }
}

function deprecated(name, replacement) {
    var message = name +
        " is deprecated and will be removed in a future version.";
    if (replacement) message += " Use " + replacement + " instead.";
    return warn(message);
}

function warn(message, shouldUseOwnTrace, promise) {
    if (!config.warnings) return;
    var warning = new Warning(message);
    var ctx;
    if (shouldUseOwnTrace) {
        promise._attachExtraTrace(warning);
    } else if (config.longStackTraces && (ctx = Promise._peekContext())) {
        ctx.attachExtraTrace(warning);
    } else {
        var parsed = parseStackAndMessage(warning);
        warning.stack = parsed.message + "\n" + parsed.stack.join("\n");
    }

    if (!activeFireEvent("warning", warning)) {
        formatAndLogError(warning, "", true);
    }
}

function reconstructStack(message, stacks) {
    for (var i = 0; i < stacks.length - 1; ++i) {
        stacks[i].push("From previous event:");
        stacks[i] = stacks[i].join("\n");
    }
    if (i < stacks.length) {
        stacks[i] = stacks[i].join("\n");
    }
    return message + "\n" + stacks.join("\n");
}

function removeDuplicateOrEmptyJumps(stacks) {
    for (var i = 0; i < stacks.length; ++i) {
        if (stacks[i].length === 0 ||
            ((i + 1 < stacks.length) && stacks[i][0] === stacks[i+1][0])) {
            stacks.splice(i, 1);
            i--;
        }
    }
}

function removeCommonRoots(stacks) {
    var current = stacks[0];
    for (var i = 1; i < stacks.length; ++i) {
        var prev = stacks[i];
        var currentLastIndex = current.length - 1;
        var currentLastLine = current[currentLastIndex];
        var commonRootMeetPoint = -1;

        for (var j = prev.length - 1; j >= 0; --j) {
            if (prev[j] === currentLastLine) {
                commonRootMeetPoint = j;
                break;
            }
        }

        for (var j = commonRootMeetPoint; j >= 0; --j) {
            var line = prev[j];
            if (current[currentLastIndex] === line) {
                current.pop();
                currentLastIndex--;
            } else {
                break;
            }
        }
        current = prev;
    }
}

function cleanStack(stack) {
    var ret = [];
    for (var i = 0; i < stack.length; ++i) {
        var line = stack[i];
        var isTraceLine = "    (No stack trace)" === line ||
            stackFramePattern.test(line);
        var isInternalFrame = isTraceLine && shouldIgnore(line);
        if (isTraceLine && !isInternalFrame) {
            if (indentStackFrames && line.charAt(0) !== " ") {
                line = "    " + line;
            }
            ret.push(line);
        }
    }
    return ret;
}

function stackFramesAsArray(error) {
    var stack = error.stack.replace(/\s+$/g, "").split("\n");
    for (var i = 0; i < stack.length; ++i) {
        var line = stack[i];
        if ("    (No stack trace)" === line || stackFramePattern.test(line)) {
            break;
        }
    }
    if (i > 0 && error.name != "SyntaxError") {
        stack = stack.slice(i);
    }
    return stack;
}

function parseStackAndMessage(error) {
    var stack = error.stack;
    var message = error.toString();
    stack = typeof stack === "string" && stack.length > 0
                ? stackFramesAsArray(error) : ["    (No stack trace)"];
    return {
        message: message,
        stack: error.name == "SyntaxError" ? stack : cleanStack(stack)
    };
}

function formatAndLogError(error, title, isSoft) {
    if (typeof console !== "undefined") {
        var message;
        if (util.isObject(error)) {
            var stack = error.stack;
            message = title + formatStack(stack, error);
        } else {
            message = title + String(error);
        }
        if (typeof printWarning === "function") {
            printWarning(message, isSoft);
        } else if (typeof console.log === "function" ||
            typeof console.log === "object") {
            console.log(message);
        }
    }
}

function fireRejectionEvent(name, localHandler, reason, promise) {
    var localEventFired = false;
    try {
        if (typeof localHandler === "function") {
            localEventFired = true;
            if (name === "rejectionHandled") {
                localHandler(promise);
            } else {
                localHandler(reason, promise);
            }
        }
    } catch (e) {
        async.throwLater(e);
    }

    if (name === "unhandledRejection") {
        if (!activeFireEvent(name, reason, promise) && !localEventFired) {
            formatAndLogError(reason, "Unhandled rejection ");
        }
    } else {
        activeFireEvent(name, promise);
    }
}

function formatNonError(obj) {
    var str;
    if (typeof obj === "function") {
        str = "[function " +
            (obj.name || "anonymous") +
            "]";
    } else {
        str = obj && typeof obj.toString === "function"
            ? obj.toString() : util.toString(obj);
        var ruselessToString = /\[object [a-zA-Z0-9$_]+\]/;
        if (ruselessToString.test(str)) {
            try {
                var newStr = JSON.stringify(obj);
                str = newStr;
            }
            catch(e) {

            }
        }
        if (str.length === 0) {
            str = "(empty array)";
        }
    }
    return ("(<" + snip(str) + ">, no stack trace)");
}

function snip(str) {
    var maxChars = 41;
    if (str.length < maxChars) {
        return str;
    }
    return str.substr(0, maxChars - 3) + "...";
}

function longStackTracesIsSupported() {
    return typeof captureStackTrace === "function";
}

var shouldIgnore = function() { return false; };
var parseLineInfoRegex = /[\/<\(]([^:\/]+):(\d+):(?:\d+)\)?\s*$/;
function parseLineInfo(line) {
    var matches = line.match(parseLineInfoRegex);
    if (matches) {
        return {
            fileName: matches[1],
            line: parseInt(matches[2], 10)
        };
    }
}

function setBounds(firstLineError, lastLineError) {
    if (!longStackTracesIsSupported()) return;
    var firstStackLines = firstLineError.stack.split("\n");
    var lastStackLines = lastLineError.stack.split("\n");
    var firstIndex = -1;
    var lastIndex = -1;
    var firstFileName;
    var lastFileName;
    for (var i = 0; i < firstStackLines.length; ++i) {
        var result = parseLineInfo(firstStackLines[i]);
        if (result) {
            firstFileName = result.fileName;
            firstIndex = result.line;
            break;
        }
    }
    for (var i = 0; i < lastStackLines.length; ++i) {
        var result = parseLineInfo(lastStackLines[i]);
        if (result) {
            lastFileName = result.fileName;
            lastIndex = result.line;
            break;
        }
    }
    if (firstIndex < 0 || lastIndex < 0 || !firstFileName || !lastFileName ||
        firstFileName !== lastFileName || firstIndex >= lastIndex) {
        return;
    }

    shouldIgnore = function(line) {
        if (bluebirdFramePattern.test(line)) return true;
        var info = parseLineInfo(line);
        if (info) {
            if (info.fileName === firstFileName &&
                (firstIndex <= info.line && info.line <= lastIndex)) {
                return true;
            }
        }
        return false;
    };
}

function CapturedTrace(parent) {
    this._parent = parent;
    this._promisesCreated = 0;
    var length = this._length = 1 + (parent === undefined ? 0 : parent._length);
    captureStackTrace(this, CapturedTrace);
    if (length > 32) this.uncycle();
}
util.inherits(CapturedTrace, Error);
Context.CapturedTrace = CapturedTrace;

CapturedTrace.prototype.uncycle = function() {
    var length = this._length;
    if (length < 2) return;
    var nodes = [];
    var stackToIndex = {};

    for (var i = 0, node = this; node !== undefined; ++i) {
        nodes.push(node);
        node = node._parent;
    }
    length = this._length = i;
    for (var i = length - 1; i >= 0; --i) {
        var stack = nodes[i].stack;
        if (stackToIndex[stack] === undefined) {
            stackToIndex[stack] = i;
        }
    }
    for (var i = 0; i < length; ++i) {
        var currentStack = nodes[i].stack;
        var index = stackToIndex[currentStack];
        if (index !== undefined && index !== i) {
            if (index > 0) {
                nodes[index - 1]._parent = undefined;
                nodes[index - 1]._length = 1;
            }
            nodes[i]._parent = undefined;
            nodes[i]._length = 1;
            var cycleEdgeNode = i > 0 ? nodes[i - 1] : this;

            if (index < length - 1) {
                cycleEdgeNode._parent = nodes[index + 1];
                cycleEdgeNode._parent.uncycle();
                cycleEdgeNode._length =
                    cycleEdgeNode._parent._length + 1;
            } else {
                cycleEdgeNode._parent = undefined;
                cycleEdgeNode._length = 1;
            }
            var currentChildLength = cycleEdgeNode._length + 1;
            for (var j = i - 2; j >= 0; --j) {
                nodes[j]._length = currentChildLength;
                currentChildLength++;
            }
            return;
        }
    }
};

CapturedTrace.prototype.attachExtraTrace = function(error) {
    if (error.__stackCleaned__) return;
    this.uncycle();
    var parsed = parseStackAndMessage(error);
    var message = parsed.message;
    var stacks = [parsed.stack];

    var trace = this;
    while (trace !== undefined) {
        stacks.push(cleanStack(trace.stack.split("\n")));
        trace = trace._parent;
    }
    removeCommonRoots(stacks);
    removeDuplicateOrEmptyJumps(stacks);
    util.notEnumerableProp(error, "stack", reconstructStack(message, stacks));
    util.notEnumerableProp(error, "__stackCleaned__", true);
};

var captureStackTrace = (function stackDetection() {
    var v8stackFramePattern = /^\s*at\s*/;
    var v8stackFormatter = function(stack, error) {
        if (typeof stack === "string") return stack;

        if (error.name !== undefined &&
            error.message !== undefined) {
            return error.toString();
        }
        return formatNonError(error);
    };

    if (typeof Error.stackTraceLimit === "number" &&
        typeof Error.captureStackTrace === "function") {
        Error.stackTraceLimit += 6;
        stackFramePattern = v8stackFramePattern;
        formatStack = v8stackFormatter;
        var captureStackTrace = Error.captureStackTrace;

        shouldIgnore = function(line) {
            return bluebirdFramePattern.test(line);
        };
        return function(receiver, ignoreUntil) {
            Error.stackTraceLimit += 6;
            captureStackTrace(receiver, ignoreUntil);
            Error.stackTraceLimit -= 6;
        };
    }
    var err = new Error();

    if (typeof err.stack === "string" &&
        err.stack.split("\n")[0].indexOf("stackDetection@") >= 0) {
        stackFramePattern = /@/;
        formatStack = v8stackFormatter;
        indentStackFrames = true;
        return function captureStackTrace(o) {
            o.stack = new Error().stack;
        };
    }

    var hasStackAfterThrow;
    try { throw new Error(); }
    catch(e) {
        hasStackAfterThrow = ("stack" in e);
    }
    if (!("stack" in err) && hasStackAfterThrow &&
        typeof Error.stackTraceLimit === "number") {
        stackFramePattern = v8stackFramePattern;
        formatStack = v8stackFormatter;
        return function captureStackTrace(o) {
            Error.stackTraceLimit += 6;
            try { throw new Error(); }
            catch(e) { o.stack = e.stack; }
            Error.stackTraceLimit -= 6;
        };
    }

    formatStack = function(stack, error) {
        if (typeof stack === "string") return stack;

        if ((typeof error === "object" ||
            typeof error === "function") &&
            error.name !== undefined &&
            error.message !== undefined) {
            return error.toString();
        }
        return formatNonError(error);
    };

    return null;

})([]);

if (typeof console !== "undefined" && typeof console.warn !== "undefined") {
    printWarning = function (message) {
        console.warn(message);
    };
    if (util.isNode && process.stderr.isTTY) {
        printWarning = function(message, isSoft) {
            var color = isSoft ? "\u001b[33m" : "\u001b[31m";
            console.warn(color + message + "\u001b[0m\n");
        };
    } else if (!util.isNode && typeof (new Error().stack) === "string") {
        printWarning = function(message, isSoft) {
            console.warn("%c" + message,
                        isSoft ? "color: darkorange" : "color: red");
        };
    }
}

var config = {
    warnings: warnings,
    longStackTraces: false,
    cancellation: false,
    monitoring: false
};

if (longStackTraces) Promise.longStackTraces();

return {
    longStackTraces: function() {
        return config.longStackTraces;
    },
    warnings: function() {
        return config.warnings;
    },
    cancellation: function() {
        return config.cancellation;
    },
    monitoring: function() {
        return config.monitoring;
    },
    propagateFromFunction: function() {
        return propagateFromFunction;
    },
    boundValueFunction: function() {
        return boundValueFunction;
    },
    checkForgottenReturns: checkForgottenReturns,
    setBounds: setBounds,
    warn: warn,
    deprecated: deprecated,
    CapturedTrace: CapturedTrace,
    fireDomEvent: fireDomEvent,
    fireGlobalEvent: fireGlobalEvent
};
};


/***/ }),

/***/ 11917:
/***/ (function(module) {

"use strict";

module.exports = function(Promise) {
function returner() {
    return this.value;
}
function thrower() {
    throw this.reason;
}

Promise.prototype["return"] =
Promise.prototype.thenReturn = function (value) {
    if (value instanceof Promise) value.suppressUnhandledRejections();
    return this._then(
        returner, undefined, undefined, {value: value}, undefined);
};

Promise.prototype["throw"] =
Promise.prototype.thenThrow = function (reason) {
    return this._then(
        thrower, undefined, undefined, {reason: reason}, undefined);
};

Promise.prototype.catchThrow = function (reason) {
    if (arguments.length <= 1) {
        return this._then(
            undefined, thrower, undefined, {reason: reason}, undefined);
    } else {
        var _reason = arguments[1];
        var handler = function() {throw _reason;};
        return this.caught(reason, handler);
    }
};

Promise.prototype.catchReturn = function (value) {
    if (arguments.length <= 1) {
        if (value instanceof Promise) value.suppressUnhandledRejections();
        return this._then(
            undefined, returner, undefined, {value: value}, undefined);
    } else {
        var _value = arguments[1];
        if (_value instanceof Promise) _value.suppressUnhandledRejections();
        var handler = function() {return _value;};
        return this.caught(value, handler);
    }
};
};


/***/ }),

/***/ 11922:
/***/ (function(module) {

"use strict";

module.exports = function(Promise, INTERNAL) {
var PromiseReduce = Promise.reduce;
var PromiseAll = Promise.all;

function promiseAllThis() {
    return PromiseAll(this);
}

function PromiseMapSeries(promises, fn) {
    return PromiseReduce(promises, fn, INTERNAL, INTERNAL);
}

Promise.prototype.each = function (fn) {
    return PromiseReduce(this, fn, INTERNAL, 0)
              ._then(promiseAllThis, undefined, undefined, this, undefined);
};

Promise.prototype.mapSeries = function (fn) {
    return PromiseReduce(this, fn, INTERNAL, INTERNAL);
};

Promise.each = function (promises, fn) {
    return PromiseReduce(promises, fn, INTERNAL, 0)
              ._then(promiseAllThis, undefined, undefined, promises, undefined);
};

Promise.mapSeries = PromiseMapSeries;
};



/***/ }),

/***/ 23828:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var es5 = __webpack_require__(28760);
var Objectfreeze = es5.freeze;
var util = __webpack_require__(95427);
var inherits = util.inherits;
var notEnumerableProp = util.notEnumerableProp;

function subError(nameProperty, defaultMessage) {
    function SubError(message) {
        if (!(this instanceof SubError)) return new SubError(message);
        notEnumerableProp(this, "message",
            typeof message === "string" ? message : defaultMessage);
        notEnumerableProp(this, "name", nameProperty);
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, this.constructor);
        } else {
            Error.call(this);
        }
    }
    inherits(SubError, Error);
    return SubError;
}

var _TypeError, _RangeError;
var Warning = subError("Warning", "warning");
var CancellationError = subError("CancellationError", "cancellation error");
var TimeoutError = subError("TimeoutError", "timeout error");
var AggregateError = subError("AggregateError", "aggregate error");
try {
    _TypeError = TypeError;
    _RangeError = RangeError;
} catch(e) {
    _TypeError = subError("TypeError", "type error");
    _RangeError = subError("RangeError", "range error");
}

var methods = ("join pop push shift unshift slice filter forEach some " +
    "every map indexOf lastIndexOf reduce reduceRight sort reverse").split(" ");

for (var i = 0; i < methods.length; ++i) {
    if (typeof Array.prototype[methods[i]] === "function") {
        AggregateError.prototype[methods[i]] = Array.prototype[methods[i]];
    }
}

es5.defineProperty(AggregateError.prototype, "length", {
    value: 0,
    configurable: false,
    writable: true,
    enumerable: true
});
AggregateError.prototype["isOperational"] = true;
var level = 0;
AggregateError.prototype.toString = function() {
    var indent = Array(level * 4 + 1).join(" ");
    var ret = "\n" + indent + "AggregateError of:" + "\n";
    level++;
    indent = Array(level * 4 + 1).join(" ");
    for (var i = 0; i < this.length; ++i) {
        var str = this[i] === this ? "[Circular AggregateError]" : this[i] + "";
        var lines = str.split("\n");
        for (var j = 0; j < lines.length; ++j) {
            lines[j] = indent + lines[j];
        }
        str = lines.join("\n");
        ret += str + "\n";
    }
    level--;
    return ret;
};

function OperationalError(message) {
    if (!(this instanceof OperationalError))
        return new OperationalError(message);
    notEnumerableProp(this, "name", "OperationalError");
    notEnumerableProp(this, "message", message);
    this.cause = message;
    this["isOperational"] = true;

    if (message instanceof Error) {
        notEnumerableProp(this, "message", message.message);
        notEnumerableProp(this, "stack", message.stack);
    } else if (Error.captureStackTrace) {
        Error.captureStackTrace(this, this.constructor);
    }

}
inherits(OperationalError, Error);

var errorTypes = Error["__BluebirdErrorTypes__"];
if (!errorTypes) {
    errorTypes = Objectfreeze({
        CancellationError: CancellationError,
        TimeoutError: TimeoutError,
        OperationalError: OperationalError,
        RejectionError: OperationalError,
        AggregateError: AggregateError
    });
    es5.defineProperty(Error, "__BluebirdErrorTypes__", {
        value: errorTypes,
        writable: false,
        enumerable: false,
        configurable: false
    });
}

module.exports = {
    Error: Error,
    TypeError: _TypeError,
    RangeError: _RangeError,
    CancellationError: errorTypes.CancellationError,
    OperationalError: errorTypes.OperationalError,
    TimeoutError: errorTypes.TimeoutError,
    AggregateError: errorTypes.AggregateError,
    Warning: Warning
};


/***/ }),

/***/ 28760:
/***/ (function(module) {

var isES5 = (function(){
    "use strict";
    return this === undefined;
})();

if (isES5) {
    module.exports = {
        freeze: Object.freeze,
        defineProperty: Object.defineProperty,
        getDescriptor: Object.getOwnPropertyDescriptor,
        keys: Object.keys,
        names: Object.getOwnPropertyNames,
        getPrototypeOf: Object.getPrototypeOf,
        isArray: Array.isArray,
        isES5: isES5,
        propertyIsWritable: function(obj, prop) {
            var descriptor = Object.getOwnPropertyDescriptor(obj, prop);
            return !!(!descriptor || descriptor.writable || descriptor.set);
        }
    };
} else {
    var has = {}.hasOwnProperty;
    var str = {}.toString;
    var proto = {}.constructor.prototype;

    var ObjectKeys = function (o) {
        var ret = [];
        for (var key in o) {
            if (has.call(o, key)) {
                ret.push(key);
            }
        }
        return ret;
    };

    var ObjectGetDescriptor = function(o, key) {
        return {value: o[key]};
    };

    var ObjectDefineProperty = function (o, key, desc) {
        o[key] = desc.value;
        return o;
    };

    var ObjectFreeze = function (obj) {
        return obj;
    };

    var ObjectGetPrototypeOf = function (obj) {
        try {
            return Object(obj).constructor.prototype;
        }
        catch (e) {
            return proto;
        }
    };

    var ArrayIsArray = function (obj) {
        try {
            return str.call(obj) === "[object Array]";
        }
        catch(e) {
            return false;
        }
    };

    module.exports = {
        isArray: ArrayIsArray,
        keys: ObjectKeys,
        names: ObjectKeys,
        defineProperty: ObjectDefineProperty,
        getDescriptor: ObjectGetDescriptor,
        freeze: ObjectFreeze,
        getPrototypeOf: ObjectGetPrototypeOf,
        isES5: isES5,
        propertyIsWritable: function() {
            return true;
        }
    };
}


/***/ }),

/***/ 56669:
/***/ (function(module) {

"use strict";

module.exports = function(Promise, INTERNAL) {
var PromiseMap = Promise.map;

Promise.prototype.filter = function (fn, options) {
    return PromiseMap(this, fn, options, INTERNAL);
};

Promise.filter = function (promises, fn, options) {
    return PromiseMap(promises, fn, options, INTERNAL);
};
};


/***/ }),

/***/ 47436:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise, tryConvertToPromise) {
var util = __webpack_require__(95427);
var CancellationError = Promise.CancellationError;
var errorObj = util.errorObj;

function PassThroughHandlerContext(promise, type, handler) {
    this.promise = promise;
    this.type = type;
    this.handler = handler;
    this.called = false;
    this.cancelPromise = null;
}

PassThroughHandlerContext.prototype.isFinallyHandler = function() {
    return this.type === 0;
};

function FinallyHandlerCancelReaction(finallyHandler) {
    this.finallyHandler = finallyHandler;
}

FinallyHandlerCancelReaction.prototype._resultCancelled = function() {
    checkCancel(this.finallyHandler);
};

function checkCancel(ctx, reason) {
    if (ctx.cancelPromise != null) {
        if (arguments.length > 1) {
            ctx.cancelPromise._reject(reason);
        } else {
            ctx.cancelPromise._cancel();
        }
        ctx.cancelPromise = null;
        return true;
    }
    return false;
}

function succeed() {
    return finallyHandler.call(this, this.promise._target()._settledValue());
}
function fail(reason) {
    if (checkCancel(this, reason)) return;
    errorObj.e = reason;
    return errorObj;
}
function finallyHandler(reasonOrValue) {
    var promise = this.promise;
    var handler = this.handler;

    if (!this.called) {
        this.called = true;
        var ret = this.isFinallyHandler()
            ? handler.call(promise._boundValue())
            : handler.call(promise._boundValue(), reasonOrValue);
        if (ret !== undefined) {
            promise._setReturnedNonUndefined();
            var maybePromise = tryConvertToPromise(ret, promise);
            if (maybePromise instanceof Promise) {
                if (this.cancelPromise != null) {
                    if (maybePromise._isCancelled()) {
                        var reason =
                            new CancellationError("late cancellation observer");
                        promise._attachExtraTrace(reason);
                        errorObj.e = reason;
                        return errorObj;
                    } else if (maybePromise.isPending()) {
                        maybePromise._attachCancellationCallback(
                            new FinallyHandlerCancelReaction(this));
                    }
                }
                return maybePromise._then(
                    succeed, fail, undefined, this, undefined);
            }
        }
    }

    if (promise.isRejected()) {
        checkCancel(this);
        errorObj.e = reasonOrValue;
        return errorObj;
    } else {
        checkCancel(this);
        return reasonOrValue;
    }
}

Promise.prototype._passThrough = function(handler, type, success, fail) {
    if (typeof handler !== "function") return this.then();
    return this._then(success,
                      fail,
                      undefined,
                      new PassThroughHandlerContext(this, type, handler),
                      undefined);
};

Promise.prototype.lastly =
Promise.prototype["finally"] = function (handler) {
    return this._passThrough(handler,
                             0,
                             finallyHandler,
                             finallyHandler);
};

Promise.prototype.tap = function (handler) {
    return this._passThrough(handler, 1, finallyHandler);
};

return PassThroughHandlerContext;
};


/***/ }),

/***/ 65189:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise,
                          apiRejection,
                          INTERNAL,
                          tryConvertToPromise,
                          Proxyable,
                          debug) {
var errors = __webpack_require__(23828);
var TypeError = errors.TypeError;
var util = __webpack_require__(95427);
var errorObj = util.errorObj;
var tryCatch = util.tryCatch;
var yieldHandlers = [];

function promiseFromYieldHandler(value, yieldHandlers, traceParent) {
    for (var i = 0; i < yieldHandlers.length; ++i) {
        traceParent._pushContext();
        var result = tryCatch(yieldHandlers[i])(value);
        traceParent._popContext();
        if (result === errorObj) {
            traceParent._pushContext();
            var ret = Promise.reject(errorObj.e);
            traceParent._popContext();
            return ret;
        }
        var maybePromise = tryConvertToPromise(result, traceParent);
        if (maybePromise instanceof Promise) return maybePromise;
    }
    return null;
}

function PromiseSpawn(generatorFunction, receiver, yieldHandler, stack) {
    if (debug.cancellation()) {
        var internal = new Promise(INTERNAL);
        var _finallyPromise = this._finallyPromise = new Promise(INTERNAL);
        this._promise = internal.lastly(function() {
            return _finallyPromise;
        });
        internal._captureStackTrace();
        internal._setOnCancel(this);
    } else {
        var promise = this._promise = new Promise(INTERNAL);
        promise._captureStackTrace();
    }
    this._stack = stack;
    this._generatorFunction = generatorFunction;
    this._receiver = receiver;
    this._generator = undefined;
    this._yieldHandlers = typeof yieldHandler === "function"
        ? [yieldHandler].concat(yieldHandlers)
        : yieldHandlers;
    this._yieldedPromise = null;
    this._cancellationPhase = false;
}
util.inherits(PromiseSpawn, Proxyable);

PromiseSpawn.prototype._isResolved = function() {
    return this._promise === null;
};

PromiseSpawn.prototype._cleanup = function() {
    this._promise = this._generator = null;
    if (debug.cancellation() && this._finallyPromise !== null) {
        this._finallyPromise._fulfill();
        this._finallyPromise = null;
    }
};

PromiseSpawn.prototype._promiseCancelled = function() {
    if (this._isResolved()) return;
    var implementsReturn = typeof this._generator["return"] !== "undefined";

    var result;
    if (!implementsReturn) {
        var reason = new Promise.CancellationError(
            "generator .return() sentinel");
        Promise.coroutine.returnSentinel = reason;
        this._promise._attachExtraTrace(reason);
        this._promise._pushContext();
        result = tryCatch(this._generator["throw"]).call(this._generator,
                                                         reason);
        this._promise._popContext();
    } else {
        this._promise._pushContext();
        result = tryCatch(this._generator["return"]).call(this._generator,
                                                          undefined);
        this._promise._popContext();
    }
    this._cancellationPhase = true;
    this._yieldedPromise = null;
    this._continue(result);
};

PromiseSpawn.prototype._promiseFulfilled = function(value) {
    this._yieldedPromise = null;
    this._promise._pushContext();
    var result = tryCatch(this._generator.next).call(this._generator, value);
    this._promise._popContext();
    this._continue(result);
};

PromiseSpawn.prototype._promiseRejected = function(reason) {
    this._yieldedPromise = null;
    this._promise._attachExtraTrace(reason);
    this._promise._pushContext();
    var result = tryCatch(this._generator["throw"])
        .call(this._generator, reason);
    this._promise._popContext();
    this._continue(result);
};

PromiseSpawn.prototype._resultCancelled = function() {
    if (this._yieldedPromise instanceof Promise) {
        var promise = this._yieldedPromise;
        this._yieldedPromise = null;
        promise.cancel();
    }
};

PromiseSpawn.prototype.promise = function () {
    return this._promise;
};

PromiseSpawn.prototype._run = function () {
    this._generator = this._generatorFunction.call(this._receiver);
    this._receiver =
        this._generatorFunction = undefined;
    this._promiseFulfilled(undefined);
};

PromiseSpawn.prototype._continue = function (result) {
    var promise = this._promise;
    if (result === errorObj) {
        this._cleanup();
        if (this._cancellationPhase) {
            return promise.cancel();
        } else {
            return promise._rejectCallback(result.e, false);
        }
    }

    var value = result.value;
    if (result.done === true) {
        this._cleanup();
        if (this._cancellationPhase) {
            return promise.cancel();
        } else {
            return promise._resolveCallback(value);
        }
    } else {
        var maybePromise = tryConvertToPromise(value, this._promise);
        if (!(maybePromise instanceof Promise)) {
            maybePromise =
                promiseFromYieldHandler(maybePromise,
                                        this._yieldHandlers,
                                        this._promise);
            if (maybePromise === null) {
                this._promiseRejected(
                    new TypeError(
                        "A value %s was yielded that could not be treated as a promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a\u000a".replace("%s", value) +
                        "From coroutine:\u000a" +
                        this._stack.split("\n").slice(1, -7).join("\n")
                    )
                );
                return;
            }
        }
        maybePromise = maybePromise._target();
        var bitField = maybePromise._bitField;
        ;
        if (((bitField & 50397184) === 0)) {
            this._yieldedPromise = maybePromise;
            maybePromise._proxy(this, null);
        } else if (((bitField & 33554432) !== 0)) {
            Promise._async.invoke(
                this._promiseFulfilled, this, maybePromise._value()
            );
        } else if (((bitField & 16777216) !== 0)) {
            Promise._async.invoke(
                this._promiseRejected, this, maybePromise._reason()
            );
        } else {
            this._promiseCancelled();
        }
    }
};

Promise.coroutine = function (generatorFunction, options) {
    if (typeof generatorFunction !== "function") {
        throw new TypeError("generatorFunction must be a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    var yieldHandler = Object(options).yieldHandler;
    var PromiseSpawn$ = PromiseSpawn;
    var stack = new Error().stack;
    return function () {
        var generator = generatorFunction.apply(this, arguments);
        var spawn = new PromiseSpawn$(undefined, undefined, yieldHandler,
                                      stack);
        var ret = spawn.promise();
        spawn._generator = generator;
        spawn._promiseFulfilled(undefined);
        return ret;
    };
};

Promise.coroutine.addYieldHandler = function(fn) {
    if (typeof fn !== "function") {
        throw new TypeError("expecting a function but got " + util.classString(fn));
    }
    yieldHandlers.push(fn);
};

Promise.spawn = function (generatorFunction) {
    debug.deprecated("Promise.spawn()", "Promise.coroutine()");
    if (typeof generatorFunction !== "function") {
        return apiRejection("generatorFunction must be a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    var spawn = new PromiseSpawn(generatorFunction, this);
    var ret = spawn.promise();
    spawn._run(Promise.spawn);
    return ret;
};
};


/***/ }),

/***/ 52823:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports =
function(Promise, PromiseArray, tryConvertToPromise, INTERNAL, async,
         getDomain) {
var util = __webpack_require__(95427);
var canEvaluate = util.canEvaluate;
var tryCatch = util.tryCatch;
var errorObj = util.errorObj;
var reject;

if (true) {
if (canEvaluate) {
    var thenCallback = function(i) {
        return new Function("value", "holder", "                             \n\
            'use strict';                                                    \n\
            holder.pIndex = value;                                           \n\
            holder.checkFulfillment(this);                                   \n\
            ".replace(/Index/g, i));
    };

    var promiseSetter = function(i) {
        return new Function("promise", "holder", "                           \n\
            'use strict';                                                    \n\
            holder.pIndex = promise;                                         \n\
            ".replace(/Index/g, i));
    };

    var generateHolderClass = function(total) {
        var props = new Array(total);
        for (var i = 0; i < props.length; ++i) {
            props[i] = "this.p" + (i+1);
        }
        var assignment = props.join(" = ") + " = null;";
        var cancellationCode= "var promise;\n" + props.map(function(prop) {
            return "                                                         \n\
                promise = " + prop + ";                                      \n\
                if (promise instanceof Promise) {                            \n\
                    promise.cancel();                                        \n\
                }                                                            \n\
            ";
        }).join("\n");
        var passedArguments = props.join(", ");
        var name = "Holder$" + total;


        var code = "return function(tryCatch, errorObj, Promise, async) {    \n\
            'use strict';                                                    \n\
            function [TheName](fn) {                                         \n\
                [TheProperties]                                              \n\
                this.fn = fn;                                                \n\
                this.asyncNeeded = true;                                     \n\
                this.now = 0;                                                \n\
            }                                                                \n\
                                                                             \n\
            [TheName].prototype._callFunction = function(promise) {          \n\
                promise._pushContext();                                      \n\
                var ret = tryCatch(this.fn)([ThePassedArguments]);           \n\
                promise._popContext();                                       \n\
                if (ret === errorObj) {                                      \n\
                    promise._rejectCallback(ret.e, false);                   \n\
                } else {                                                     \n\
                    promise._resolveCallback(ret);                           \n\
                }                                                            \n\
            };                                                               \n\
                                                                             \n\
            [TheName].prototype.checkFulfillment = function(promise) {       \n\
                var now = ++this.now;                                        \n\
                if (now === [TheTotal]) {                                    \n\
                    if (this.asyncNeeded) {                                  \n\
                        async.invoke(this._callFunction, this, promise);     \n\
                    } else {                                                 \n\
                        this._callFunction(promise);                         \n\
                    }                                                        \n\
                                                                             \n\
                }                                                            \n\
            };                                                               \n\
                                                                             \n\
            [TheName].prototype._resultCancelled = function() {              \n\
                [CancellationCode]                                           \n\
            };                                                               \n\
                                                                             \n\
            return [TheName];                                                \n\
        }(tryCatch, errorObj, Promise, async);                               \n\
        ";

        code = code.replace(/\[TheName\]/g, name)
            .replace(/\[TheTotal\]/g, total)
            .replace(/\[ThePassedArguments\]/g, passedArguments)
            .replace(/\[TheProperties\]/g, assignment)
            .replace(/\[CancellationCode\]/g, cancellationCode);

        return new Function("tryCatch", "errorObj", "Promise", "async", code)
                           (tryCatch, errorObj, Promise, async);
    };

    var holderClasses = [];
    var thenCallbacks = [];
    var promiseSetters = [];

    for (var i = 0; i < 8; ++i) {
        holderClasses.push(generateHolderClass(i + 1));
        thenCallbacks.push(thenCallback(i + 1));
        promiseSetters.push(promiseSetter(i + 1));
    }

    reject = function (reason) {
        this._reject(reason);
    };
}}

Promise.join = function () {
    var last = arguments.length - 1;
    var fn;
    if (last > 0 && typeof arguments[last] === "function") {
        fn = arguments[last];
        if (true) {
            if (last <= 8 && canEvaluate) {
                var ret = new Promise(INTERNAL);
                ret._captureStackTrace();
                var HolderClass = holderClasses[last - 1];
                var holder = new HolderClass(fn);
                var callbacks = thenCallbacks;

                for (var i = 0; i < last; ++i) {
                    var maybePromise = tryConvertToPromise(arguments[i], ret);
                    if (maybePromise instanceof Promise) {
                        maybePromise = maybePromise._target();
                        var bitField = maybePromise._bitField;
                        ;
                        if (((bitField & 50397184) === 0)) {
                            maybePromise._then(callbacks[i], reject,
                                               undefined, ret, holder);
                            promiseSetters[i](maybePromise, holder);
                            holder.asyncNeeded = false;
                        } else if (((bitField & 33554432) !== 0)) {
                            callbacks[i].call(ret,
                                              maybePromise._value(), holder);
                        } else if (((bitField & 16777216) !== 0)) {
                            ret._reject(maybePromise._reason());
                        } else {
                            ret._cancel();
                        }
                    } else {
                        callbacks[i].call(ret, maybePromise, holder);
                    }
                }

                if (!ret._isFateSealed()) {
                    if (holder.asyncNeeded) {
                        var domain = getDomain();
                        if (domain !== null) {
                            holder.fn = util.domainBind(domain, holder.fn);
                        }
                    }
                    ret._setAsyncGuaranteed();
                    ret._setOnCancel(holder);
                }
                return ret;
            }
        }
    }
    var $_len = arguments.length;var args = new Array($_len); for(var $_i = 0; $_i < $_len; ++$_i) {args[$_i] = arguments[$_i];};
    if (fn) args.pop();
    var ret = new PromiseArray(args).promise();
    return fn !== undefined ? ret.spread(fn) : ret;
};

};


/***/ }),

/***/ 8633:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise,
                          PromiseArray,
                          apiRejection,
                          tryConvertToPromise,
                          INTERNAL,
                          debug) {
var getDomain = Promise._getDomain;
var util = __webpack_require__(95427);
var tryCatch = util.tryCatch;
var errorObj = util.errorObj;
var async = Promise._async;

function MappingPromiseArray(promises, fn, limit, _filter) {
    this.constructor$(promises);
    this._promise._captureStackTrace();
    var domain = getDomain();
    this._callback = domain === null ? fn : util.domainBind(domain, fn);
    this._preservedValues = _filter === INTERNAL
        ? new Array(this.length())
        : null;
    this._limit = limit;
    this._inFlight = 0;
    this._queue = [];
    async.invoke(this._asyncInit, this, undefined);
}
util.inherits(MappingPromiseArray, PromiseArray);

MappingPromiseArray.prototype._asyncInit = function() {
    this._init$(undefined, -2);
};

MappingPromiseArray.prototype._init = function () {};

MappingPromiseArray.prototype._promiseFulfilled = function (value, index) {
    var values = this._values;
    var length = this.length();
    var preservedValues = this._preservedValues;
    var limit = this._limit;

    if (index < 0) {
        index = (index * -1) - 1;
        values[index] = value;
        if (limit >= 1) {
            this._inFlight--;
            this._drainQueue();
            if (this._isResolved()) return true;
        }
    } else {
        if (limit >= 1 && this._inFlight >= limit) {
            values[index] = value;
            this._queue.push(index);
            return false;
        }
        if (preservedValues !== null) preservedValues[index] = value;

        var promise = this._promise;
        var callback = this._callback;
        var receiver = promise._boundValue();
        promise._pushContext();
        var ret = tryCatch(callback).call(receiver, value, index, length);
        var promiseCreated = promise._popContext();
        debug.checkForgottenReturns(
            ret,
            promiseCreated,
            preservedValues !== null ? "Promise.filter" : "Promise.map",
            promise
        );
        if (ret === errorObj) {
            this._reject(ret.e);
            return true;
        }

        var maybePromise = tryConvertToPromise(ret, this._promise);
        if (maybePromise instanceof Promise) {
            maybePromise = maybePromise._target();
            var bitField = maybePromise._bitField;
            ;
            if (((bitField & 50397184) === 0)) {
                if (limit >= 1) this._inFlight++;
                values[index] = maybePromise;
                maybePromise._proxy(this, (index + 1) * -1);
                return false;
            } else if (((bitField & 33554432) !== 0)) {
                ret = maybePromise._value();
            } else if (((bitField & 16777216) !== 0)) {
                this._reject(maybePromise._reason());
                return true;
            } else {
                this._cancel();
                return true;
            }
        }
        values[index] = ret;
    }
    var totalResolved = ++this._totalResolved;
    if (totalResolved >= length) {
        if (preservedValues !== null) {
            this._filter(values, preservedValues);
        } else {
            this._resolve(values);
        }
        return true;
    }
    return false;
};

MappingPromiseArray.prototype._drainQueue = function () {
    var queue = this._queue;
    var limit = this._limit;
    var values = this._values;
    while (queue.length > 0 && this._inFlight < limit) {
        if (this._isResolved()) return;
        var index = queue.pop();
        this._promiseFulfilled(values[index], index);
    }
};

MappingPromiseArray.prototype._filter = function (booleans, values) {
    var len = values.length;
    var ret = new Array(len);
    var j = 0;
    for (var i = 0; i < len; ++i) {
        if (booleans[i]) ret[j++] = values[i];
    }
    ret.length = j;
    this._resolve(ret);
};

MappingPromiseArray.prototype.preservedValues = function () {
    return this._preservedValues;
};

function map(promises, fn, options, _filter) {
    if (typeof fn !== "function") {
        return apiRejection("expecting a function but got " + util.classString(fn));
    }

    var limit = 0;
    if (options !== undefined) {
        if (typeof options === "object" && options !== null) {
            if (typeof options.concurrency !== "number") {
                return Promise.reject(
                    new TypeError("'concurrency' must be a number but it is " +
                                    util.classString(options.concurrency)));
            }
            limit = options.concurrency;
        } else {
            return Promise.reject(new TypeError(
                            "options argument must be an object but it is " +
                             util.classString(options)));
        }
    }
    limit = typeof limit === "number" &&
        isFinite(limit) && limit >= 1 ? limit : 0;
    return new MappingPromiseArray(promises, fn, limit, _filter).promise();
}

Promise.prototype.map = function (fn, options) {
    return map(this, fn, options, null);
};

Promise.map = function (promises, fn, options, _filter) {
    return map(promises, fn, options, _filter);
};


};


/***/ }),

/***/ 29754:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports =
function(Promise, INTERNAL, tryConvertToPromise, apiRejection, debug) {
var util = __webpack_require__(95427);
var tryCatch = util.tryCatch;

Promise.method = function (fn) {
    if (typeof fn !== "function") {
        throw new Promise.TypeError("expecting a function but got " + util.classString(fn));
    }
    return function () {
        var ret = new Promise(INTERNAL);
        ret._captureStackTrace();
        ret._pushContext();
        var value = tryCatch(fn).apply(this, arguments);
        var promiseCreated = ret._popContext();
        debug.checkForgottenReturns(
            value, promiseCreated, "Promise.method", ret);
        ret._resolveFromSyncValue(value);
        return ret;
    };
};

Promise.attempt = Promise["try"] = function (fn) {
    if (typeof fn !== "function") {
        return apiRejection("expecting a function but got " + util.classString(fn));
    }
    var ret = new Promise(INTERNAL);
    ret._captureStackTrace();
    ret._pushContext();
    var value;
    if (arguments.length > 1) {
        debug.deprecated("calling Promise.try with more than 1 argument");
        var arg = arguments[1];
        var ctx = arguments[2];
        value = util.isArray(arg) ? tryCatch(fn).apply(ctx, arg)
                                  : tryCatch(fn).call(ctx, arg);
    } else {
        value = tryCatch(fn)();
    }
    var promiseCreated = ret._popContext();
    debug.checkForgottenReturns(
        value, promiseCreated, "Promise.try", ret);
    ret._resolveFromSyncValue(value);
    return ret;
};

Promise.prototype._resolveFromSyncValue = function (value) {
    if (value === util.errorObj) {
        this._rejectCallback(value.e, false);
    } else {
        this._resolveCallback(value, true);
    }
};
};


/***/ }),

/***/ 87292:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var util = __webpack_require__(95427);
var maybeWrapAsError = util.maybeWrapAsError;
var errors = __webpack_require__(23828);
var OperationalError = errors.OperationalError;
var es5 = __webpack_require__(28760);

function isUntypedError(obj) {
    return obj instanceof Error &&
        es5.getPrototypeOf(obj) === Error.prototype;
}

var rErrorKey = /^(?:name|message|stack|cause)$/;
function wrapAsOperationalError(obj) {
    var ret;
    if (isUntypedError(obj)) {
        ret = new OperationalError(obj);
        ret.name = obj.name;
        ret.message = obj.message;
        ret.stack = obj.stack;
        var keys = es5.keys(obj);
        for (var i = 0; i < keys.length; ++i) {
            var key = keys[i];
            if (!rErrorKey.test(key)) {
                ret[key] = obj[key];
            }
        }
        return ret;
    }
    util.markAsOriginatingFromRejection(obj);
    return obj;
}

function nodebackForPromise(promise, multiArgs) {
    return function(err, value) {
        if (promise === null) return;
        if (err) {
            var wrapped = wrapAsOperationalError(maybeWrapAsError(err));
            promise._attachExtraTrace(wrapped);
            promise._reject(wrapped);
        } else if (!multiArgs) {
            promise._fulfill(value);
        } else {
            var $_len = arguments.length;var args = new Array(Math.max($_len - 1, 0)); for(var $_i = 1; $_i < $_len; ++$_i) {args[$_i - 1] = arguments[$_i];};
            promise._fulfill(args);
        }
        promise = null;
    };
}

module.exports = nodebackForPromise;


/***/ }),

/***/ 34617:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise) {
var util = __webpack_require__(95427);
var async = Promise._async;
var tryCatch = util.tryCatch;
var errorObj = util.errorObj;

function spreadAdapter(val, nodeback) {
    var promise = this;
    if (!util.isArray(val)) return successAdapter.call(promise, val, nodeback);
    var ret =
        tryCatch(nodeback).apply(promise._boundValue(), [null].concat(val));
    if (ret === errorObj) {
        async.throwLater(ret.e);
    }
}

function successAdapter(val, nodeback) {
    var promise = this;
    var receiver = promise._boundValue();
    var ret = val === undefined
        ? tryCatch(nodeback).call(receiver, null)
        : tryCatch(nodeback).call(receiver, null, val);
    if (ret === errorObj) {
        async.throwLater(ret.e);
    }
}
function errorAdapter(reason, nodeback) {
    var promise = this;
    if (!reason) {
        var newReason = new Error(reason + "");
        newReason.cause = reason;
        reason = newReason;
    }
    var ret = tryCatch(nodeback).call(promise._boundValue(), reason);
    if (ret === errorObj) {
        async.throwLater(ret.e);
    }
}

Promise.prototype.asCallback = Promise.prototype.nodeify = function (nodeback,
                                                                     options) {
    if (typeof nodeback == "function") {
        var adapter = successAdapter;
        if (options !== undefined && Object(options).spread) {
            adapter = spreadAdapter;
        }
        this._then(
            adapter,
            errorAdapter,
            undefined,
            this,
            nodeback
        );
    }
    return this;
};
};


/***/ }),

/***/ 88410:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function() {
var makeSelfResolutionError = function () {
    return new TypeError("circular promise resolution chain\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
};
var reflectHandler = function() {
    return new Promise.PromiseInspection(this._target());
};
var apiRejection = function(msg) {
    return Promise.reject(new TypeError(msg));
};
function Proxyable() {}
var UNDEFINED_BINDING = {};
var util = __webpack_require__(95427);

var getDomain;
if (util.isNode) {
    getDomain = function() {
        var ret = process.domain;
        if (ret === undefined) ret = null;
        return ret;
    };
} else {
    getDomain = function() {
        return null;
    };
}
util.notEnumerableProp(Promise, "_getDomain", getDomain);

var es5 = __webpack_require__(28760);
var Async = __webpack_require__(47283);
var async = new Async();
es5.defineProperty(Promise, "_async", {value: async});
var errors = __webpack_require__(23828);
var TypeError = Promise.TypeError = errors.TypeError;
Promise.RangeError = errors.RangeError;
var CancellationError = Promise.CancellationError = errors.CancellationError;
Promise.TimeoutError = errors.TimeoutError;
Promise.OperationalError = errors.OperationalError;
Promise.RejectionError = errors.OperationalError;
Promise.AggregateError = errors.AggregateError;
var INTERNAL = function(){};
var APPLY = {};
var NEXT_FILTER = {};
var tryConvertToPromise = __webpack_require__(7343)(Promise, INTERNAL);
var PromiseArray =
    __webpack_require__(72840)(Promise, INTERNAL,
                               tryConvertToPromise, apiRejection, Proxyable);
var Context = __webpack_require__(49232)(Promise);
 /*jshint unused:false*/
var createContext = Context.create;
var debug = __webpack_require__(29833)(Promise, Context);
var CapturedTrace = debug.CapturedTrace;
var PassThroughHandlerContext =
    __webpack_require__(47436)(Promise, tryConvertToPromise);
var catchFilter = __webpack_require__(38021)(NEXT_FILTER);
var nodebackForPromise = __webpack_require__(87292);
var errorObj = util.errorObj;
var tryCatch = util.tryCatch;
function check(self, executor) {
    if (typeof executor !== "function") {
        throw new TypeError("expecting a function but got " + util.classString(executor));
    }
    if (self.constructor !== Promise) {
        throw new TypeError("the promise constructor cannot be invoked directly\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
}

function Promise(executor) {
    this._bitField = 0;
    this._fulfillmentHandler0 = undefined;
    this._rejectionHandler0 = undefined;
    this._promise0 = undefined;
    this._receiver0 = undefined;
    if (executor !== INTERNAL) {
        check(this, executor);
        this._resolveFromExecutor(executor);
    }
    this._promiseCreated();
    this._fireEvent("promiseCreated", this);
}

Promise.prototype.toString = function () {
    return "[object Promise]";
};

Promise.prototype.caught = Promise.prototype["catch"] = function (fn) {
    var len = arguments.length;
    if (len > 1) {
        var catchInstances = new Array(len - 1),
            j = 0, i;
        for (i = 0; i < len - 1; ++i) {
            var item = arguments[i];
            if (util.isObject(item)) {
                catchInstances[j++] = item;
            } else {
                return apiRejection("expecting an object but got " +
                    "A catch statement predicate " + util.classString(item));
            }
        }
        catchInstances.length = j;
        fn = arguments[i];
        return this.then(undefined, catchFilter(catchInstances, fn, this));
    }
    return this.then(undefined, fn);
};

Promise.prototype.reflect = function () {
    return this._then(reflectHandler,
        reflectHandler, undefined, this, undefined);
};

Promise.prototype.then = function (didFulfill, didReject) {
    if (debug.warnings() && arguments.length > 0 &&
        typeof didFulfill !== "function" &&
        typeof didReject !== "function") {
        var msg = ".then() only accepts functions but was passed: " +
                util.classString(didFulfill);
        if (arguments.length > 1) {
            msg += ", " + util.classString(didReject);
        }
        this._warn(msg);
    }
    return this._then(didFulfill, didReject, undefined, undefined, undefined);
};

Promise.prototype.done = function (didFulfill, didReject) {
    var promise =
        this._then(didFulfill, didReject, undefined, undefined, undefined);
    promise._setIsFinal();
};

Promise.prototype.spread = function (fn) {
    if (typeof fn !== "function") {
        return apiRejection("expecting a function but got " + util.classString(fn));
    }
    return this.all()._then(fn, undefined, undefined, APPLY, undefined);
};

Promise.prototype.toJSON = function () {
    var ret = {
        isFulfilled: false,
        isRejected: false,
        fulfillmentValue: undefined,
        rejectionReason: undefined
    };
    if (this.isFulfilled()) {
        ret.fulfillmentValue = this.value();
        ret.isFulfilled = true;
    } else if (this.isRejected()) {
        ret.rejectionReason = this.reason();
        ret.isRejected = true;
    }
    return ret;
};

Promise.prototype.all = function () {
    if (arguments.length > 0) {
        this._warn(".all() was passed arguments but it does not take any");
    }
    return new PromiseArray(this).promise();
};

Promise.prototype.error = function (fn) {
    return this.caught(util.originatesFromRejection, fn);
};

Promise.getNewLibraryCopy = module.exports;

Promise.is = function (val) {
    return val instanceof Promise;
};

Promise.fromNode = Promise.fromCallback = function(fn) {
    var ret = new Promise(INTERNAL);
    ret._captureStackTrace();
    var multiArgs = arguments.length > 1 ? !!Object(arguments[1]).multiArgs
                                         : false;
    var result = tryCatch(fn)(nodebackForPromise(ret, multiArgs));
    if (result === errorObj) {
        ret._rejectCallback(result.e, true);
    }
    if (!ret._isFateSealed()) ret._setAsyncGuaranteed();
    return ret;
};

Promise.all = function (promises) {
    return new PromiseArray(promises).promise();
};

Promise.cast = function (obj) {
    var ret = tryConvertToPromise(obj);
    if (!(ret instanceof Promise)) {
        ret = new Promise(INTERNAL);
        ret._captureStackTrace();
        ret._setFulfilled();
        ret._rejectionHandler0 = obj;
    }
    return ret;
};

Promise.resolve = Promise.fulfilled = Promise.cast;

Promise.reject = Promise.rejected = function (reason) {
    var ret = new Promise(INTERNAL);
    ret._captureStackTrace();
    ret._rejectCallback(reason, true);
    return ret;
};

Promise.setScheduler = function(fn) {
    if (typeof fn !== "function") {
        throw new TypeError("expecting a function but got " + util.classString(fn));
    }
    return async.setScheduler(fn);
};

Promise.prototype._then = function (
    didFulfill,
    didReject,
    _,    receiver,
    internalData
) {
    var haveInternalData = internalData !== undefined;
    var promise = haveInternalData ? internalData : new Promise(INTERNAL);
    var target = this._target();
    var bitField = target._bitField;

    if (!haveInternalData) {
        promise._propagateFrom(this, 3);
        promise._captureStackTrace();
        if (receiver === undefined &&
            ((this._bitField & 2097152) !== 0)) {
            if (!((bitField & 50397184) === 0)) {
                receiver = this._boundValue();
            } else {
                receiver = target === this ? undefined : this._boundTo;
            }
        }
        this._fireEvent("promiseChained", this, promise);
    }

    var domain = getDomain();
    if (!((bitField & 50397184) === 0)) {
        var handler, value, settler = target._settlePromiseCtx;
        if (((bitField & 33554432) !== 0)) {
            value = target._rejectionHandler0;
            handler = didFulfill;
        } else if (((bitField & 16777216) !== 0)) {
            value = target._fulfillmentHandler0;
            handler = didReject;
            target._unsetRejectionIsUnhandled();
        } else {
            settler = target._settlePromiseLateCancellationObserver;
            value = new CancellationError("late cancellation observer");
            target._attachExtraTrace(value);
            handler = didReject;
        }

        async.invoke(settler, target, {
            handler: domain === null ? handler
                : (typeof handler === "function" &&
                    util.domainBind(domain, handler)),
            promise: promise,
            receiver: receiver,
            value: value
        });
    } else {
        target._addCallbacks(didFulfill, didReject, promise, receiver, domain);
    }

    return promise;
};

Promise.prototype._length = function () {
    return this._bitField & 65535;
};

Promise.prototype._isFateSealed = function () {
    return (this._bitField & 117506048) !== 0;
};

Promise.prototype._isFollowing = function () {
    return (this._bitField & 67108864) === 67108864;
};

Promise.prototype._setLength = function (len) {
    this._bitField = (this._bitField & -65536) |
        (len & 65535);
};

Promise.prototype._setFulfilled = function () {
    this._bitField = this._bitField | 33554432;
    this._fireEvent("promiseFulfilled", this);
};

Promise.prototype._setRejected = function () {
    this._bitField = this._bitField | 16777216;
    this._fireEvent("promiseRejected", this);
};

Promise.prototype._setFollowing = function () {
    this._bitField = this._bitField | 67108864;
    this._fireEvent("promiseResolved", this);
};

Promise.prototype._setIsFinal = function () {
    this._bitField = this._bitField | 4194304;
};

Promise.prototype._isFinal = function () {
    return (this._bitField & 4194304) > 0;
};

Promise.prototype._unsetCancelled = function() {
    this._bitField = this._bitField & (~65536);
};

Promise.prototype._setCancelled = function() {
    this._bitField = this._bitField | 65536;
    this._fireEvent("promiseCancelled", this);
};

Promise.prototype._setWillBeCancelled = function() {
    this._bitField = this._bitField | 8388608;
};

Promise.prototype._setAsyncGuaranteed = function() {
    if (async.hasCustomScheduler()) return;
    this._bitField = this._bitField | 134217728;
};

Promise.prototype._receiverAt = function (index) {
    var ret = index === 0 ? this._receiver0 : this[
            index * 4 - 4 + 3];
    if (ret === UNDEFINED_BINDING) {
        return undefined;
    } else if (ret === undefined && this._isBound()) {
        return this._boundValue();
    }
    return ret;
};

Promise.prototype._promiseAt = function (index) {
    return this[
            index * 4 - 4 + 2];
};

Promise.prototype._fulfillmentHandlerAt = function (index) {
    return this[
            index * 4 - 4 + 0];
};

Promise.prototype._rejectionHandlerAt = function (index) {
    return this[
            index * 4 - 4 + 1];
};

Promise.prototype._boundValue = function() {};

Promise.prototype._migrateCallback0 = function (follower) {
    var bitField = follower._bitField;
    var fulfill = follower._fulfillmentHandler0;
    var reject = follower._rejectionHandler0;
    var promise = follower._promise0;
    var receiver = follower._receiverAt(0);
    if (receiver === undefined) receiver = UNDEFINED_BINDING;
    this._addCallbacks(fulfill, reject, promise, receiver, null);
};

Promise.prototype._migrateCallbackAt = function (follower, index) {
    var fulfill = follower._fulfillmentHandlerAt(index);
    var reject = follower._rejectionHandlerAt(index);
    var promise = follower._promiseAt(index);
    var receiver = follower._receiverAt(index);
    if (receiver === undefined) receiver = UNDEFINED_BINDING;
    this._addCallbacks(fulfill, reject, promise, receiver, null);
};

Promise.prototype._addCallbacks = function (
    fulfill,
    reject,
    promise,
    receiver,
    domain
) {
    var index = this._length();

    if (index >= 65535 - 4) {
        index = 0;
        this._setLength(0);
    }

    if (index === 0) {
        this._promise0 = promise;
        this._receiver0 = receiver;
        if (typeof fulfill === "function") {
            this._fulfillmentHandler0 =
                domain === null ? fulfill : util.domainBind(domain, fulfill);
        }
        if (typeof reject === "function") {
            this._rejectionHandler0 =
                domain === null ? reject : util.domainBind(domain, reject);
        }
    } else {
        var base = index * 4 - 4;
        this[base + 2] = promise;
        this[base + 3] = receiver;
        if (typeof fulfill === "function") {
            this[base + 0] =
                domain === null ? fulfill : util.domainBind(domain, fulfill);
        }
        if (typeof reject === "function") {
            this[base + 1] =
                domain === null ? reject : util.domainBind(domain, reject);
        }
    }
    this._setLength(index + 1);
    return index;
};

Promise.prototype._proxy = function (proxyable, arg) {
    this._addCallbacks(undefined, undefined, arg, proxyable, null);
};

Promise.prototype._resolveCallback = function(value, shouldBind) {
    if (((this._bitField & 117506048) !== 0)) return;
    if (value === this)
        return this._rejectCallback(makeSelfResolutionError(), false);
    var maybePromise = tryConvertToPromise(value, this);
    if (!(maybePromise instanceof Promise)) return this._fulfill(value);

    if (shouldBind) this._propagateFrom(maybePromise, 2);

    var promise = maybePromise._target();

    if (promise === this) {
        this._reject(makeSelfResolutionError());
        return;
    }

    var bitField = promise._bitField;
    if (((bitField & 50397184) === 0)) {
        var len = this._length();
        if (len > 0) promise._migrateCallback0(this);
        for (var i = 1; i < len; ++i) {
            promise._migrateCallbackAt(this, i);
        }
        this._setFollowing();
        this._setLength(0);
        this._setFollowee(promise);
    } else if (((bitField & 33554432) !== 0)) {
        this._fulfill(promise._value());
    } else if (((bitField & 16777216) !== 0)) {
        this._reject(promise._reason());
    } else {
        var reason = new CancellationError("late cancellation observer");
        promise._attachExtraTrace(reason);
        this._reject(reason);
    }
};

Promise.prototype._rejectCallback =
function(reason, synchronous, ignoreNonErrorWarnings) {
    var trace = util.ensureErrorObject(reason);
    var hasStack = trace === reason;
    if (!hasStack && !ignoreNonErrorWarnings && debug.warnings()) {
        var message = "a promise was rejected with a non-error: " +
            util.classString(reason);
        this._warn(message, true);
    }
    this._attachExtraTrace(trace, synchronous ? hasStack : false);
    this._reject(reason);
};

Promise.prototype._resolveFromExecutor = function (executor) {
    var promise = this;
    this._captureStackTrace();
    this._pushContext();
    var synchronous = true;
    var r = this._execute(executor, function(value) {
        promise._resolveCallback(value);
    }, function (reason) {
        promise._rejectCallback(reason, synchronous);
    });
    synchronous = false;
    this._popContext();

    if (r !== undefined) {
        promise._rejectCallback(r, true);
    }
};

Promise.prototype._settlePromiseFromHandler = function (
    handler, receiver, value, promise
) {
    var bitField = promise._bitField;
    if (((bitField & 65536) !== 0)) return;
    promise._pushContext();
    var x;
    if (receiver === APPLY) {
        if (!value || typeof value.length !== "number") {
            x = errorObj;
            x.e = new TypeError("cannot .spread() a non-array: " +
                                    util.classString(value));
        } else {
            x = tryCatch(handler).apply(this._boundValue(), value);
        }
    } else {
        x = tryCatch(handler).call(receiver, value);
    }
    var promiseCreated = promise._popContext();
    bitField = promise._bitField;
    if (((bitField & 65536) !== 0)) return;

    if (x === NEXT_FILTER) {
        promise._reject(value);
    } else if (x === errorObj) {
        promise._rejectCallback(x.e, false);
    } else {
        debug.checkForgottenReturns(x, promiseCreated, "",  promise, this);
        promise._resolveCallback(x);
    }
};

Promise.prototype._target = function() {
    var ret = this;
    while (ret._isFollowing()) ret = ret._followee();
    return ret;
};

Promise.prototype._followee = function() {
    return this._rejectionHandler0;
};

Promise.prototype._setFollowee = function(promise) {
    this._rejectionHandler0 = promise;
};

Promise.prototype._settlePromise = function(promise, handler, receiver, value) {
    var isPromise = promise instanceof Promise;
    var bitField = this._bitField;
    var asyncGuaranteed = ((bitField & 134217728) !== 0);
    if (((bitField & 65536) !== 0)) {
        if (isPromise) promise._invokeInternalOnCancel();

        if (receiver instanceof PassThroughHandlerContext &&
            receiver.isFinallyHandler()) {
            receiver.cancelPromise = promise;
            if (tryCatch(handler).call(receiver, value) === errorObj) {
                promise._reject(errorObj.e);
            }
        } else if (handler === reflectHandler) {
            promise._fulfill(reflectHandler.call(receiver));
        } else if (receiver instanceof Proxyable) {
            receiver._promiseCancelled(promise);
        } else if (isPromise || promise instanceof PromiseArray) {
            promise._cancel();
        } else {
            receiver.cancel();
        }
    } else if (typeof handler === "function") {
        if (!isPromise) {
            handler.call(receiver, value, promise);
        } else {
            if (asyncGuaranteed) promise._setAsyncGuaranteed();
            this._settlePromiseFromHandler(handler, receiver, value, promise);
        }
    } else if (receiver instanceof Proxyable) {
        if (!receiver._isResolved()) {
            if (((bitField & 33554432) !== 0)) {
                receiver._promiseFulfilled(value, promise);
            } else {
                receiver._promiseRejected(value, promise);
            }
        }
    } else if (isPromise) {
        if (asyncGuaranteed) promise._setAsyncGuaranteed();
        if (((bitField & 33554432) !== 0)) {
            promise._fulfill(value);
        } else {
            promise._reject(value);
        }
    }
};

Promise.prototype._settlePromiseLateCancellationObserver = function(ctx) {
    var handler = ctx.handler;
    var promise = ctx.promise;
    var receiver = ctx.receiver;
    var value = ctx.value;
    if (typeof handler === "function") {
        if (!(promise instanceof Promise)) {
            handler.call(receiver, value, promise);
        } else {
            this._settlePromiseFromHandler(handler, receiver, value, promise);
        }
    } else if (promise instanceof Promise) {
        promise._reject(value);
    }
};

Promise.prototype._settlePromiseCtx = function(ctx) {
    this._settlePromise(ctx.promise, ctx.handler, ctx.receiver, ctx.value);
};

Promise.prototype._settlePromise0 = function(handler, value, bitField) {
    var promise = this._promise0;
    var receiver = this._receiverAt(0);
    this._promise0 = undefined;
    this._receiver0 = undefined;
    this._settlePromise(promise, handler, receiver, value);
};

Promise.prototype._clearCallbackDataAtIndex = function(index) {
    var base = index * 4 - 4;
    this[base + 2] =
    this[base + 3] =
    this[base + 0] =
    this[base + 1] = undefined;
};

Promise.prototype._fulfill = function (value) {
    var bitField = this._bitField;
    if (((bitField & 117506048) >>> 16)) return;
    if (value === this) {
        var err = makeSelfResolutionError();
        this._attachExtraTrace(err);
        return this._reject(err);
    }
    this._setFulfilled();
    this._rejectionHandler0 = value;

    if ((bitField & 65535) > 0) {
        if (((bitField & 134217728) !== 0)) {
            this._settlePromises();
        } else {
            async.settlePromises(this);
        }
    }
};

Promise.prototype._reject = function (reason) {
    var bitField = this._bitField;
    if (((bitField & 117506048) >>> 16)) return;
    this._setRejected();
    this._fulfillmentHandler0 = reason;

    if (this._isFinal()) {
        return async.fatalError(reason, util.isNode);
    }

    if ((bitField & 65535) > 0) {
        async.settlePromises(this);
    } else {
        this._ensurePossibleRejectionHandled();
    }
};

Promise.prototype._fulfillPromises = function (len, value) {
    for (var i = 1; i < len; i++) {
        var handler = this._fulfillmentHandlerAt(i);
        var promise = this._promiseAt(i);
        var receiver = this._receiverAt(i);
        this._clearCallbackDataAtIndex(i);
        this._settlePromise(promise, handler, receiver, value);
    }
};

Promise.prototype._rejectPromises = function (len, reason) {
    for (var i = 1; i < len; i++) {
        var handler = this._rejectionHandlerAt(i);
        var promise = this._promiseAt(i);
        var receiver = this._receiverAt(i);
        this._clearCallbackDataAtIndex(i);
        this._settlePromise(promise, handler, receiver, reason);
    }
};

Promise.prototype._settlePromises = function () {
    var bitField = this._bitField;
    var len = (bitField & 65535);

    if (len > 0) {
        if (((bitField & 16842752) !== 0)) {
            var reason = this._fulfillmentHandler0;
            this._settlePromise0(this._rejectionHandler0, reason, bitField);
            this._rejectPromises(len, reason);
        } else {
            var value = this._rejectionHandler0;
            this._settlePromise0(this._fulfillmentHandler0, value, bitField);
            this._fulfillPromises(len, value);
        }
        this._setLength(0);
    }
    this._clearCancellationData();
};

Promise.prototype._settledValue = function() {
    var bitField = this._bitField;
    if (((bitField & 33554432) !== 0)) {
        return this._rejectionHandler0;
    } else if (((bitField & 16777216) !== 0)) {
        return this._fulfillmentHandler0;
    }
};

function deferResolve(v) {this.promise._resolveCallback(v);}
function deferReject(v) {this.promise._rejectCallback(v, false);}

Promise.defer = Promise.pending = function() {
    debug.deprecated("Promise.defer", "new Promise");
    var promise = new Promise(INTERNAL);
    return {
        promise: promise,
        resolve: deferResolve,
        reject: deferReject
    };
};

util.notEnumerableProp(Promise,
                       "_makeSelfResolutionError",
                       makeSelfResolutionError);

__webpack_require__(29754)(Promise, INTERNAL, tryConvertToPromise, apiRejection,
    debug);
__webpack_require__(52124)(Promise, INTERNAL, tryConvertToPromise, debug);
__webpack_require__(87357)(Promise, PromiseArray, apiRejection, debug);
__webpack_require__(11917)(Promise);
__webpack_require__(45603)(Promise);
__webpack_require__(52823)(
    Promise, PromiseArray, tryConvertToPromise, INTERNAL, async, getDomain);
Promise.Promise = Promise;
Promise.version = "3.4.7";
__webpack_require__(8633)(Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug);
__webpack_require__(90196)(Promise);
__webpack_require__(80435)(Promise, apiRejection, tryConvertToPromise, createContext, INTERNAL, debug);
__webpack_require__(35297)(Promise, INTERNAL, debug);
__webpack_require__(65189)(Promise, apiRejection, INTERNAL, tryConvertToPromise, Proxyable, debug);
__webpack_require__(34617)(Promise);
__webpack_require__(27295)(Promise, INTERNAL);
__webpack_require__(26521)(Promise, PromiseArray, tryConvertToPromise, apiRejection);
__webpack_require__(81206)(Promise, INTERNAL, tryConvertToPromise, apiRejection);
__webpack_require__(52385)(Promise, PromiseArray, apiRejection, tryConvertToPromise, INTERNAL, debug);
__webpack_require__(19372)(Promise, PromiseArray, debug);
__webpack_require__(45671)(Promise, PromiseArray, apiRejection);
__webpack_require__(56669)(Promise, INTERNAL);
__webpack_require__(11922)(Promise, INTERNAL);
__webpack_require__(97605)(Promise);
                                                         
    util.toFastProperties(Promise);                                          
    util.toFastProperties(Promise.prototype);                                
    function fillTypes(value) {                                              
        var p = new Promise(INTERNAL);                                       
        p._fulfillmentHandler0 = value;                                      
        p._rejectionHandler0 = value;                                        
        p._promise0 = value;                                                 
        p._receiver0 = value;                                                
    }                                                                        
    // Complete slack tracking, opt out of field-type tracking and           
    // stabilize map                                                         
    fillTypes({a: 1});                                                       
    fillTypes({b: 2});                                                       
    fillTypes({c: 3});                                                       
    fillTypes(1);                                                            
    fillTypes(function(){});                                                 
    fillTypes(undefined);                                                    
    fillTypes(false);                                                        
    fillTypes(new Promise(INTERNAL));                                        
    debug.setBounds(Async.firstLineError, util.lastLineError);               
    return Promise;                                                          

};


/***/ }),

/***/ 72840:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise, INTERNAL, tryConvertToPromise,
    apiRejection, Proxyable) {
var util = __webpack_require__(95427);
var isArray = util.isArray;

function toResolutionValue(val) {
    switch(val) {
    case -2: return [];
    case -3: return {};
    }
}

function PromiseArray(values) {
    var promise = this._promise = new Promise(INTERNAL);
    if (values instanceof Promise) {
        promise._propagateFrom(values, 3);
    }
    promise._setOnCancel(this);
    this._values = values;
    this._length = 0;
    this._totalResolved = 0;
    this._init(undefined, -2);
}
util.inherits(PromiseArray, Proxyable);

PromiseArray.prototype.length = function () {
    return this._length;
};

PromiseArray.prototype.promise = function () {
    return this._promise;
};

PromiseArray.prototype._init = function init(_, resolveValueIfEmpty) {
    var values = tryConvertToPromise(this._values, this._promise);
    if (values instanceof Promise) {
        values = values._target();
        var bitField = values._bitField;
        ;
        this._values = values;

        if (((bitField & 50397184) === 0)) {
            this._promise._setAsyncGuaranteed();
            return values._then(
                init,
                this._reject,
                undefined,
                this,
                resolveValueIfEmpty
           );
        } else if (((bitField & 33554432) !== 0)) {
            values = values._value();
        } else if (((bitField & 16777216) !== 0)) {
            return this._reject(values._reason());
        } else {
            return this._cancel();
        }
    }
    values = util.asArray(values);
    if (values === null) {
        var err = apiRejection(
            "expecting an array or an iterable object but got " + util.classString(values)).reason();
        this._promise._rejectCallback(err, false);
        return;
    }

    if (values.length === 0) {
        if (resolveValueIfEmpty === -5) {
            this._resolveEmptyArray();
        }
        else {
            this._resolve(toResolutionValue(resolveValueIfEmpty));
        }
        return;
    }
    this._iterate(values);
};

PromiseArray.prototype._iterate = function(values) {
    var len = this.getActualLength(values.length);
    this._length = len;
    this._values = this.shouldCopyValues() ? new Array(len) : this._values;
    var result = this._promise;
    var isResolved = false;
    var bitField = null;
    for (var i = 0; i < len; ++i) {
        var maybePromise = tryConvertToPromise(values[i], result);

        if (maybePromise instanceof Promise) {
            maybePromise = maybePromise._target();
            bitField = maybePromise._bitField;
        } else {
            bitField = null;
        }

        if (isResolved) {
            if (bitField !== null) {
                maybePromise.suppressUnhandledRejections();
            }
        } else if (bitField !== null) {
            if (((bitField & 50397184) === 0)) {
                maybePromise._proxy(this, i);
                this._values[i] = maybePromise;
            } else if (((bitField & 33554432) !== 0)) {
                isResolved = this._promiseFulfilled(maybePromise._value(), i);
            } else if (((bitField & 16777216) !== 0)) {
                isResolved = this._promiseRejected(maybePromise._reason(), i);
            } else {
                isResolved = this._promiseCancelled(i);
            }
        } else {
            isResolved = this._promiseFulfilled(maybePromise, i);
        }
    }
    if (!isResolved) result._setAsyncGuaranteed();
};

PromiseArray.prototype._isResolved = function () {
    return this._values === null;
};

PromiseArray.prototype._resolve = function (value) {
    this._values = null;
    this._promise._fulfill(value);
};

PromiseArray.prototype._cancel = function() {
    if (this._isResolved() || !this._promise._isCancellable()) return;
    this._values = null;
    this._promise._cancel();
};

PromiseArray.prototype._reject = function (reason) {
    this._values = null;
    this._promise._rejectCallback(reason, false);
};

PromiseArray.prototype._promiseFulfilled = function (value, index) {
    this._values[index] = value;
    var totalResolved = ++this._totalResolved;
    if (totalResolved >= this._length) {
        this._resolve(this._values);
        return true;
    }
    return false;
};

PromiseArray.prototype._promiseCancelled = function() {
    this._cancel();
    return true;
};

PromiseArray.prototype._promiseRejected = function (reason) {
    this._totalResolved++;
    this._reject(reason);
    return true;
};

PromiseArray.prototype._resultCancelled = function() {
    if (this._isResolved()) return;
    var values = this._values;
    this._cancel();
    if (values instanceof Promise) {
        values.cancel();
    } else {
        for (var i = 0; i < values.length; ++i) {
            if (values[i] instanceof Promise) {
                values[i].cancel();
            }
        }
    }
};

PromiseArray.prototype.shouldCopyValues = function () {
    return true;
};

PromiseArray.prototype.getActualLength = function (len) {
    return len;
};

return PromiseArray;
};


/***/ }),

/***/ 27295:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise, INTERNAL) {
var THIS = {};
var util = __webpack_require__(95427);
var nodebackForPromise = __webpack_require__(87292);
var withAppended = util.withAppended;
var maybeWrapAsError = util.maybeWrapAsError;
var canEvaluate = util.canEvaluate;
var TypeError = (__webpack_require__(23828).TypeError);
var defaultSuffix = "Async";
var defaultPromisified = {__isPromisified__: true};
var noCopyProps = [
    "arity",    "length",
    "name",
    "arguments",
    "caller",
    "callee",
    "prototype",
    "__isPromisified__"
];
var noCopyPropsPattern = new RegExp("^(?:" + noCopyProps.join("|") + ")$");

var defaultFilter = function(name) {
    return util.isIdentifier(name) &&
        name.charAt(0) !== "_" &&
        name !== "constructor";
};

function propsFilter(key) {
    return !noCopyPropsPattern.test(key);
}

function isPromisified(fn) {
    try {
        return fn.__isPromisified__ === true;
    }
    catch (e) {
        return false;
    }
}

function hasPromisified(obj, key, suffix) {
    var val = util.getDataPropertyOrDefault(obj, key + suffix,
                                            defaultPromisified);
    return val ? isPromisified(val) : false;
}
function checkValid(ret, suffix, suffixRegexp) {
    for (var i = 0; i < ret.length; i += 2) {
        var key = ret[i];
        if (suffixRegexp.test(key)) {
            var keyWithoutAsyncSuffix = key.replace(suffixRegexp, "");
            for (var j = 0; j < ret.length; j += 2) {
                if (ret[j] === keyWithoutAsyncSuffix) {
                    throw new TypeError("Cannot promisify an API that has normal methods with '%s'-suffix\u000a\u000a    See http://goo.gl/MqrFmX\u000a"
                        .replace("%s", suffix));
                }
            }
        }
    }
}

function promisifiableMethods(obj, suffix, suffixRegexp, filter) {
    var keys = util.inheritedDataKeys(obj);
    var ret = [];
    for (var i = 0; i < keys.length; ++i) {
        var key = keys[i];
        var value = obj[key];
        var passesDefaultFilter = filter === defaultFilter
            ? true : defaultFilter(key, value, obj);
        if (typeof value === "function" &&
            !isPromisified(value) &&
            !hasPromisified(obj, key, suffix) &&
            filter(key, value, obj, passesDefaultFilter)) {
            ret.push(key, value);
        }
    }
    checkValid(ret, suffix, suffixRegexp);
    return ret;
}

var escapeIdentRegex = function(str) {
    return str.replace(/([$])/, "\\$");
};

var makeNodePromisifiedEval;
if (true) {
var switchCaseArgumentOrder = function(likelyArgumentCount) {
    var ret = [likelyArgumentCount];
    var min = Math.max(0, likelyArgumentCount - 1 - 3);
    for(var i = likelyArgumentCount - 1; i >= min; --i) {
        ret.push(i);
    }
    for(var i = likelyArgumentCount + 1; i <= 3; ++i) {
        ret.push(i);
    }
    return ret;
};

var argumentSequence = function(argumentCount) {
    return util.filledRange(argumentCount, "_arg", "");
};

var parameterDeclaration = function(parameterCount) {
    return util.filledRange(
        Math.max(parameterCount, 3), "_arg", "");
};

var parameterCount = function(fn) {
    if (typeof fn.length === "number") {
        return Math.max(Math.min(fn.length, 1023 + 1), 0);
    }
    return 0;
};

makeNodePromisifiedEval =
function(callback, receiver, originalName, fn, _, multiArgs) {
    var newParameterCount = Math.max(0, parameterCount(fn) - 1);
    var argumentOrder = switchCaseArgumentOrder(newParameterCount);
    var shouldProxyThis = typeof callback === "string" || receiver === THIS;

    function generateCallForArgumentCount(count) {
        var args = argumentSequence(count).join(", ");
        var comma = count > 0 ? ", " : "";
        var ret;
        if (shouldProxyThis) {
            ret = "ret = callback.call(this, {{args}}, nodeback); break;\n";
        } else {
            ret = receiver === undefined
                ? "ret = callback({{args}}, nodeback); break;\n"
                : "ret = callback.call(receiver, {{args}}, nodeback); break;\n";
        }
        return ret.replace("{{args}}", args).replace(", ", comma);
    }

    function generateArgumentSwitchCase() {
        var ret = "";
        for (var i = 0; i < argumentOrder.length; ++i) {
            ret += "case " + argumentOrder[i] +":" +
                generateCallForArgumentCount(argumentOrder[i]);
        }

        ret += "                                                             \n\
        default:                                                             \n\
            var args = new Array(len + 1);                                   \n\
            var i = 0;                                                       \n\
            for (var i = 0; i < len; ++i) {                                  \n\
               args[i] = arguments[i];                                       \n\
            }                                                                \n\
            args[i] = nodeback;                                              \n\
            [CodeForCall]                                                    \n\
            break;                                                           \n\
        ".replace("[CodeForCall]", (shouldProxyThis
                                ? "ret = callback.apply(this, args);\n"
                                : "ret = callback.apply(receiver, args);\n"));
        return ret;
    }

    var getFunctionCode = typeof callback === "string"
                                ? ("this != null ? this['"+callback+"'] : fn")
                                : "fn";
    var body = "'use strict';                                                \n\
        var ret = function (Parameters) {                                    \n\
            'use strict';                                                    \n\
            var len = arguments.length;                                      \n\
            var promise = new Promise(INTERNAL);                             \n\
            promise._captureStackTrace();                                    \n\
            var nodeback = nodebackForPromise(promise, " + multiArgs + ");   \n\
            var ret;                                                         \n\
            var callback = tryCatch([GetFunctionCode]);                      \n\
            switch(len) {                                                    \n\
                [CodeForSwitchCase]                                          \n\
            }                                                                \n\
            if (ret === errorObj) {                                          \n\
                promise._rejectCallback(maybeWrapAsError(ret.e), true, true);\n\
            }                                                                \n\
            if (!promise._isFateSealed()) promise._setAsyncGuaranteed();     \n\
            return promise;                                                  \n\
        };                                                                   \n\
        notEnumerableProp(ret, '__isPromisified__', true);                   \n\
        return ret;                                                          \n\
    ".replace("[CodeForSwitchCase]", generateArgumentSwitchCase())
        .replace("[GetFunctionCode]", getFunctionCode);
    body = body.replace("Parameters", parameterDeclaration(newParameterCount));
    return new Function("Promise",
                        "fn",
                        "receiver",
                        "withAppended",
                        "maybeWrapAsError",
                        "nodebackForPromise",
                        "tryCatch",
                        "errorObj",
                        "notEnumerableProp",
                        "INTERNAL",
                        body)(
                    Promise,
                    fn,
                    receiver,
                    withAppended,
                    maybeWrapAsError,
                    nodebackForPromise,
                    util.tryCatch,
                    util.errorObj,
                    util.notEnumerableProp,
                    INTERNAL);
};
}

function makeNodePromisifiedClosure(callback, receiver, _, fn, __, multiArgs) {
    var defaultThis = (function() {return this;})();
    var method = callback;
    if (typeof method === "string") {
        callback = fn;
    }
    function promisified() {
        var _receiver = receiver;
        if (receiver === THIS) _receiver = this;
        var promise = new Promise(INTERNAL);
        promise._captureStackTrace();
        var cb = typeof method === "string" && this !== defaultThis
            ? this[method] : callback;
        var fn = nodebackForPromise(promise, multiArgs);
        try {
            cb.apply(_receiver, withAppended(arguments, fn));
        } catch(e) {
            promise._rejectCallback(maybeWrapAsError(e), true, true);
        }
        if (!promise._isFateSealed()) promise._setAsyncGuaranteed();
        return promise;
    }
    util.notEnumerableProp(promisified, "__isPromisified__", true);
    return promisified;
}

var makeNodePromisified = canEvaluate
    ? makeNodePromisifiedEval
    : makeNodePromisifiedClosure;

function promisifyAll(obj, suffix, filter, promisifier, multiArgs) {
    var suffixRegexp = new RegExp(escapeIdentRegex(suffix) + "$");
    var methods =
        promisifiableMethods(obj, suffix, suffixRegexp, filter);

    for (var i = 0, len = methods.length; i < len; i+= 2) {
        var key = methods[i];
        var fn = methods[i+1];
        var promisifiedKey = key + suffix;
        if (promisifier === makeNodePromisified) {
            obj[promisifiedKey] =
                makeNodePromisified(key, THIS, key, fn, suffix, multiArgs);
        } else {
            var promisified = promisifier(fn, function() {
                return makeNodePromisified(key, THIS, key,
                                           fn, suffix, multiArgs);
            });
            util.notEnumerableProp(promisified, "__isPromisified__", true);
            obj[promisifiedKey] = promisified;
        }
    }
    util.toFastProperties(obj);
    return obj;
}

function promisify(callback, receiver, multiArgs) {
    return makeNodePromisified(callback, receiver, undefined,
                                callback, null, multiArgs);
}

Promise.promisify = function (fn, options) {
    if (typeof fn !== "function") {
        throw new TypeError("expecting a function but got " + util.classString(fn));
    }
    if (isPromisified(fn)) {
        return fn;
    }
    options = Object(options);
    var receiver = options.context === undefined ? THIS : options.context;
    var multiArgs = !!options.multiArgs;
    var ret = promisify(fn, receiver, multiArgs);
    util.copyDescriptors(fn, ret, propsFilter);
    return ret;
};

Promise.promisifyAll = function (target, options) {
    if (typeof target !== "function" && typeof target !== "object") {
        throw new TypeError("the target of promisifyAll must be an object or a function\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    options = Object(options);
    var multiArgs = !!options.multiArgs;
    var suffix = options.suffix;
    if (typeof suffix !== "string") suffix = defaultSuffix;
    var filter = options.filter;
    if (typeof filter !== "function") filter = defaultFilter;
    var promisifier = options.promisifier;
    if (typeof promisifier !== "function") promisifier = makeNodePromisified;

    if (!util.isIdentifier(suffix)) {
        throw new RangeError("suffix must be a valid identifier\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }

    var keys = util.inheritedDataKeys(target);
    for (var i = 0; i < keys.length; ++i) {
        var value = target[keys[i]];
        if (keys[i] !== "constructor" &&
            util.isClass(value)) {
            promisifyAll(value.prototype, suffix, filter, promisifier,
                multiArgs);
            promisifyAll(value, suffix, filter, promisifier, multiArgs);
        }
    }

    return promisifyAll(target, suffix, filter, promisifier, multiArgs);
};
};



/***/ }),

/***/ 26521:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(
    Promise, PromiseArray, tryConvertToPromise, apiRejection) {
var util = __webpack_require__(95427);
var isObject = util.isObject;
var es5 = __webpack_require__(28760);
var Es6Map;
if (typeof Map === "function") Es6Map = Map;

var mapToEntries = (function() {
    var index = 0;
    var size = 0;

    function extractEntry(value, key) {
        this[index] = value;
        this[index + size] = key;
        index++;
    }

    return function mapToEntries(map) {
        size = map.size;
        index = 0;
        var ret = new Array(map.size * 2);
        map.forEach(extractEntry, ret);
        return ret;
    };
})();

var entriesToMap = function(entries) {
    var ret = new Es6Map();
    var length = entries.length / 2 | 0;
    for (var i = 0; i < length; ++i) {
        var key = entries[length + i];
        var value = entries[i];
        ret.set(key, value);
    }
    return ret;
};

function PropertiesPromiseArray(obj) {
    var isMap = false;
    var entries;
    if (Es6Map !== undefined && obj instanceof Es6Map) {
        entries = mapToEntries(obj);
        isMap = true;
    } else {
        var keys = es5.keys(obj);
        var len = keys.length;
        entries = new Array(len * 2);
        for (var i = 0; i < len; ++i) {
            var key = keys[i];
            entries[i] = obj[key];
            entries[i + len] = key;
        }
    }
    this.constructor$(entries);
    this._isMap = isMap;
    this._init$(undefined, -3);
}
util.inherits(PropertiesPromiseArray, PromiseArray);

PropertiesPromiseArray.prototype._init = function () {};

PropertiesPromiseArray.prototype._promiseFulfilled = function (value, index) {
    this._values[index] = value;
    var totalResolved = ++this._totalResolved;
    if (totalResolved >= this._length) {
        var val;
        if (this._isMap) {
            val = entriesToMap(this._values);
        } else {
            val = {};
            var keyOffset = this.length();
            for (var i = 0, len = this.length(); i < len; ++i) {
                val[this._values[i + keyOffset]] = this._values[i];
            }
        }
        this._resolve(val);
        return true;
    }
    return false;
};

PropertiesPromiseArray.prototype.shouldCopyValues = function () {
    return false;
};

PropertiesPromiseArray.prototype.getActualLength = function (len) {
    return len >> 1;
};

function props(promises) {
    var ret;
    var castValue = tryConvertToPromise(promises);

    if (!isObject(castValue)) {
        return apiRejection("cannot await properties of a non-object\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    } else if (castValue instanceof Promise) {
        ret = castValue._then(
            Promise.props, undefined, undefined, undefined, undefined);
    } else {
        ret = new PropertiesPromiseArray(castValue).promise();
    }

    if (castValue instanceof Promise) {
        ret._propagateFrom(castValue, 2);
    }
    return ret;
}

Promise.prototype.props = function () {
    return props(this);
};

Promise.props = function (promises) {
    return props(promises);
};
};


/***/ }),

/***/ 63564:
/***/ (function(module) {

"use strict";

function arrayMove(src, srcIndex, dst, dstIndex, len) {
    for (var j = 0; j < len; ++j) {
        dst[j + dstIndex] = src[j + srcIndex];
        src[j + srcIndex] = void 0;
    }
}

function Queue(capacity) {
    this._capacity = capacity;
    this._length = 0;
    this._front = 0;
}

Queue.prototype._willBeOverCapacity = function (size) {
    return this._capacity < size;
};

Queue.prototype._pushOne = function (arg) {
    var length = this.length();
    this._checkCapacity(length + 1);
    var i = (this._front + length) & (this._capacity - 1);
    this[i] = arg;
    this._length = length + 1;
};

Queue.prototype.push = function (fn, receiver, arg) {
    var length = this.length() + 3;
    if (this._willBeOverCapacity(length)) {
        this._pushOne(fn);
        this._pushOne(receiver);
        this._pushOne(arg);
        return;
    }
    var j = this._front + length - 3;
    this._checkCapacity(length);
    var wrapMask = this._capacity - 1;
    this[(j + 0) & wrapMask] = fn;
    this[(j + 1) & wrapMask] = receiver;
    this[(j + 2) & wrapMask] = arg;
    this._length = length;
};

Queue.prototype.shift = function () {
    var front = this._front,
        ret = this[front];

    this[front] = undefined;
    this._front = (front + 1) & (this._capacity - 1);
    this._length--;
    return ret;
};

Queue.prototype.length = function () {
    return this._length;
};

Queue.prototype._checkCapacity = function (size) {
    if (this._capacity < size) {
        this._resizeTo(this._capacity << 1);
    }
};

Queue.prototype._resizeTo = function (capacity) {
    var oldCapacity = this._capacity;
    this._capacity = capacity;
    var front = this._front;
    var length = this._length;
    var moveItemsCount = (front + length) & (oldCapacity - 1);
    arrayMove(this, 0, this, oldCapacity, moveItemsCount);
};

module.exports = Queue;


/***/ }),

/***/ 81206:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(
    Promise, INTERNAL, tryConvertToPromise, apiRejection) {
var util = __webpack_require__(95427);

var raceLater = function (promise) {
    return promise.then(function(array) {
        return race(array, promise);
    });
};

function race(promises, parent) {
    var maybePromise = tryConvertToPromise(promises);

    if (maybePromise instanceof Promise) {
        return raceLater(maybePromise);
    } else {
        promises = util.asArray(promises);
        if (promises === null)
            return apiRejection("expecting an array or an iterable object but got " + util.classString(promises));
    }

    var ret = new Promise(INTERNAL);
    if (parent !== undefined) {
        ret._propagateFrom(parent, 3);
    }
    var fulfill = ret._fulfill;
    var reject = ret._reject;
    for (var i = 0, len = promises.length; i < len; ++i) {
        var val = promises[i];

        if (val === undefined && !(i in promises)) {
            continue;
        }

        Promise.cast(val)._then(fulfill, reject, undefined, ret, null);
    }
    return ret;
}

Promise.race = function (promises) {
    return race(promises, undefined);
};

Promise.prototype.race = function () {
    return race(this, undefined);
};

};


/***/ }),

/***/ 52385:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise,
                          PromiseArray,
                          apiRejection,
                          tryConvertToPromise,
                          INTERNAL,
                          debug) {
var getDomain = Promise._getDomain;
var util = __webpack_require__(95427);
var tryCatch = util.tryCatch;

function ReductionPromiseArray(promises, fn, initialValue, _each) {
    this.constructor$(promises);
    var domain = getDomain();
    this._fn = domain === null ? fn : util.domainBind(domain, fn);
    if (initialValue !== undefined) {
        initialValue = Promise.resolve(initialValue);
        initialValue._attachCancellationCallback(this);
    }
    this._initialValue = initialValue;
    this._currentCancellable = null;
    if(_each === INTERNAL) {
        this._eachValues = Array(this._length);
    } else if (_each === 0) {
        this._eachValues = null;
    } else {
        this._eachValues = undefined;
    }
    this._promise._captureStackTrace();
    this._init$(undefined, -5);
}
util.inherits(ReductionPromiseArray, PromiseArray);

ReductionPromiseArray.prototype._gotAccum = function(accum) {
    if (this._eachValues !== undefined && 
        this._eachValues !== null && 
        accum !== INTERNAL) {
        this._eachValues.push(accum);
    }
};

ReductionPromiseArray.prototype._eachComplete = function(value) {
    if (this._eachValues !== null) {
        this._eachValues.push(value);
    }
    return this._eachValues;
};

ReductionPromiseArray.prototype._init = function() {};

ReductionPromiseArray.prototype._resolveEmptyArray = function() {
    this._resolve(this._eachValues !== undefined ? this._eachValues
                                                 : this._initialValue);
};

ReductionPromiseArray.prototype.shouldCopyValues = function () {
    return false;
};

ReductionPromiseArray.prototype._resolve = function(value) {
    this._promise._resolveCallback(value);
    this._values = null;
};

ReductionPromiseArray.prototype._resultCancelled = function(sender) {
    if (sender === this._initialValue) return this._cancel();
    if (this._isResolved()) return;
    this._resultCancelled$();
    if (this._currentCancellable instanceof Promise) {
        this._currentCancellable.cancel();
    }
    if (this._initialValue instanceof Promise) {
        this._initialValue.cancel();
    }
};

ReductionPromiseArray.prototype._iterate = function (values) {
    this._values = values;
    var value;
    var i;
    var length = values.length;
    if (this._initialValue !== undefined) {
        value = this._initialValue;
        i = 0;
    } else {
        value = Promise.resolve(values[0]);
        i = 1;
    }

    this._currentCancellable = value;

    if (!value.isRejected()) {
        for (; i < length; ++i) {
            var ctx = {
                accum: null,
                value: values[i],
                index: i,
                length: length,
                array: this
            };
            value = value._then(gotAccum, undefined, undefined, ctx, undefined);
        }
    }

    if (this._eachValues !== undefined) {
        value = value
            ._then(this._eachComplete, undefined, undefined, this, undefined);
    }
    value._then(completed, completed, undefined, value, this);
};

Promise.prototype.reduce = function (fn, initialValue) {
    return reduce(this, fn, initialValue, null);
};

Promise.reduce = function (promises, fn, initialValue, _each) {
    return reduce(promises, fn, initialValue, _each);
};

function completed(valueOrReason, array) {
    if (this.isFulfilled()) {
        array._resolve(valueOrReason);
    } else {
        array._reject(valueOrReason);
    }
}

function reduce(promises, fn, initialValue, _each) {
    if (typeof fn !== "function") {
        return apiRejection("expecting a function but got " + util.classString(fn));
    }
    var array = new ReductionPromiseArray(promises, fn, initialValue, _each);
    return array.promise();
}

function gotAccum(accum) {
    this.accum = accum;
    this.array._gotAccum(accum);
    var value = tryConvertToPromise(this.value, this.array._promise);
    if (value instanceof Promise) {
        this.array._currentCancellable = value;
        return value._then(gotValue, undefined, undefined, this, undefined);
    } else {
        return gotValue.call(this, value);
    }
}

function gotValue(value) {
    var array = this.array;
    var promise = array._promise;
    var fn = tryCatch(array._fn);
    promise._pushContext();
    var ret;
    if (array._eachValues !== undefined) {
        ret = fn.call(promise._boundValue(), value, this.index, this.length);
    } else {
        ret = fn.call(promise._boundValue(),
                              this.accum, value, this.index, this.length);
    }
    if (ret instanceof Promise) {
        array._currentCancellable = ret;
    }
    var promiseCreated = promise._popContext();
    debug.checkForgottenReturns(
        ret,
        promiseCreated,
        array._eachValues !== undefined ? "Promise.each" : "Promise.reduce",
        promise
    );
    return ret;
}
};


/***/ }),

/***/ 60462:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var util = __webpack_require__(95427);
var schedule;
var noAsyncScheduler = function() {
    throw new Error("No async scheduler available\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
};
var NativePromise = util.getNativePromise();
if (util.isNode && typeof MutationObserver === "undefined") {
    var GlobalSetImmediate = __webpack_require__.g.setImmediate;
    var ProcessNextTick = process.nextTick;
    schedule = util.isRecentNode
                ? function(fn) { GlobalSetImmediate.call(__webpack_require__.g, fn); }
                : function(fn) { ProcessNextTick.call(process, fn); };
} else if (typeof NativePromise === "function" &&
           typeof NativePromise.resolve === "function") {
    var nativePromise = NativePromise.resolve();
    schedule = function(fn) {
        nativePromise.then(fn);
    };
} else if ((typeof MutationObserver !== "undefined") &&
          !(typeof window !== "undefined" &&
            window.navigator &&
            (window.navigator.standalone || window.cordova))) {
    schedule = (function() {
        var div = document.createElement("div");
        var opts = {attributes: true};
        var toggleScheduled = false;
        var div2 = document.createElement("div");
        var o2 = new MutationObserver(function() {
            div.classList.toggle("foo");
            toggleScheduled = false;
        });
        o2.observe(div2, opts);

        var scheduleToggle = function() {
            if (toggleScheduled) return;
                toggleScheduled = true;
                div2.classList.toggle("foo");
            };

            return function schedule(fn) {
            var o = new MutationObserver(function() {
                o.disconnect();
                fn();
            });
            o.observe(div, opts);
            scheduleToggle();
        };
    })();
} else if (typeof setImmediate !== "undefined") {
    schedule = function (fn) {
        setImmediate(fn);
    };
} else if (typeof setTimeout !== "undefined") {
    schedule = function (fn) {
        setTimeout(fn, 0);
    };
} else {
    schedule = noAsyncScheduler;
}
module.exports = schedule;


/***/ }),

/***/ 19372:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports =
    function(Promise, PromiseArray, debug) {
var PromiseInspection = Promise.PromiseInspection;
var util = __webpack_require__(95427);

function SettledPromiseArray(values) {
    this.constructor$(values);
}
util.inherits(SettledPromiseArray, PromiseArray);

SettledPromiseArray.prototype._promiseResolved = function (index, inspection) {
    this._values[index] = inspection;
    var totalResolved = ++this._totalResolved;
    if (totalResolved >= this._length) {
        this._resolve(this._values);
        return true;
    }
    return false;
};

SettledPromiseArray.prototype._promiseFulfilled = function (value, index) {
    var ret = new PromiseInspection();
    ret._bitField = 33554432;
    ret._settledValueField = value;
    return this._promiseResolved(index, ret);
};
SettledPromiseArray.prototype._promiseRejected = function (reason, index) {
    var ret = new PromiseInspection();
    ret._bitField = 16777216;
    ret._settledValueField = reason;
    return this._promiseResolved(index, ret);
};

Promise.settle = function (promises) {
    debug.deprecated(".settle()", ".reflect()");
    return new SettledPromiseArray(promises).promise();
};

Promise.prototype.settle = function () {
    return Promise.settle(this);
};
};


/***/ }),

/***/ 45671:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports =
function(Promise, PromiseArray, apiRejection) {
var util = __webpack_require__(95427);
var RangeError = (__webpack_require__(23828).RangeError);
var AggregateError = (__webpack_require__(23828).AggregateError);
var isArray = util.isArray;
var CANCELLATION = {};


function SomePromiseArray(values) {
    this.constructor$(values);
    this._howMany = 0;
    this._unwrap = false;
    this._initialized = false;
}
util.inherits(SomePromiseArray, PromiseArray);

SomePromiseArray.prototype._init = function () {
    if (!this._initialized) {
        return;
    }
    if (this._howMany === 0) {
        this._resolve([]);
        return;
    }
    this._init$(undefined, -5);
    var isArrayResolved = isArray(this._values);
    if (!this._isResolved() &&
        isArrayResolved &&
        this._howMany > this._canPossiblyFulfill()) {
        this._reject(this._getRangeError(this.length()));
    }
};

SomePromiseArray.prototype.init = function () {
    this._initialized = true;
    this._init();
};

SomePromiseArray.prototype.setUnwrap = function () {
    this._unwrap = true;
};

SomePromiseArray.prototype.howMany = function () {
    return this._howMany;
};

SomePromiseArray.prototype.setHowMany = function (count) {
    this._howMany = count;
};

SomePromiseArray.prototype._promiseFulfilled = function (value) {
    this._addFulfilled(value);
    if (this._fulfilled() === this.howMany()) {
        this._values.length = this.howMany();
        if (this.howMany() === 1 && this._unwrap) {
            this._resolve(this._values[0]);
        } else {
            this._resolve(this._values);
        }
        return true;
    }
    return false;

};
SomePromiseArray.prototype._promiseRejected = function (reason) {
    this._addRejected(reason);
    return this._checkOutcome();
};

SomePromiseArray.prototype._promiseCancelled = function () {
    if (this._values instanceof Promise || this._values == null) {
        return this._cancel();
    }
    this._addRejected(CANCELLATION);
    return this._checkOutcome();
};

SomePromiseArray.prototype._checkOutcome = function() {
    if (this.howMany() > this._canPossiblyFulfill()) {
        var e = new AggregateError();
        for (var i = this.length(); i < this._values.length; ++i) {
            if (this._values[i] !== CANCELLATION) {
                e.push(this._values[i]);
            }
        }
        if (e.length > 0) {
            this._reject(e);
        } else {
            this._cancel();
        }
        return true;
    }
    return false;
};

SomePromiseArray.prototype._fulfilled = function () {
    return this._totalResolved;
};

SomePromiseArray.prototype._rejected = function () {
    return this._values.length - this.length();
};

SomePromiseArray.prototype._addRejected = function (reason) {
    this._values.push(reason);
};

SomePromiseArray.prototype._addFulfilled = function (value) {
    this._values[this._totalResolved++] = value;
};

SomePromiseArray.prototype._canPossiblyFulfill = function () {
    return this.length() - this._rejected();
};

SomePromiseArray.prototype._getRangeError = function (count) {
    var message = "Input array must contain at least " +
            this._howMany + " items but contains only " + count + " items";
    return new RangeError(message);
};

SomePromiseArray.prototype._resolveEmptyArray = function () {
    this._reject(this._getRangeError(0));
};

function some(promises, howMany) {
    if ((howMany | 0) !== howMany || howMany < 0) {
        return apiRejection("expecting a positive integer\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    var ret = new SomePromiseArray(promises);
    var promise = ret.promise();
    ret.setHowMany(howMany);
    ret.init();
    return promise;
}

Promise.some = function (promises, howMany) {
    return some(promises, howMany);
};

Promise.prototype.some = function (howMany) {
    return some(this, howMany);
};

Promise._SomePromiseArray = SomePromiseArray;
};


/***/ }),

/***/ 45603:
/***/ (function(module) {

"use strict";

module.exports = function(Promise) {
function PromiseInspection(promise) {
    if (promise !== undefined) {
        promise = promise._target();
        this._bitField = promise._bitField;
        this._settledValueField = promise._isFateSealed()
            ? promise._settledValue() : undefined;
    }
    else {
        this._bitField = 0;
        this._settledValueField = undefined;
    }
}

PromiseInspection.prototype._settledValue = function() {
    return this._settledValueField;
};

var value = PromiseInspection.prototype.value = function () {
    if (!this.isFulfilled()) {
        throw new TypeError("cannot get fulfillment value of a non-fulfilled promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    return this._settledValue();
};

var reason = PromiseInspection.prototype.error =
PromiseInspection.prototype.reason = function () {
    if (!this.isRejected()) {
        throw new TypeError("cannot get rejection reason of a non-rejected promise\u000a\u000a    See http://goo.gl/MqrFmX\u000a");
    }
    return this._settledValue();
};

var isFulfilled = PromiseInspection.prototype.isFulfilled = function() {
    return (this._bitField & 33554432) !== 0;
};

var isRejected = PromiseInspection.prototype.isRejected = function () {
    return (this._bitField & 16777216) !== 0;
};

var isPending = PromiseInspection.prototype.isPending = function () {
    return (this._bitField & 50397184) === 0;
};

var isResolved = PromiseInspection.prototype.isResolved = function () {
    return (this._bitField & 50331648) !== 0;
};

PromiseInspection.prototype.isCancelled = function() {
    return (this._bitField & 8454144) !== 0;
};

Promise.prototype.__isCancelled = function() {
    return (this._bitField & 65536) === 65536;
};

Promise.prototype._isCancelled = function() {
    return this._target().__isCancelled();
};

Promise.prototype.isCancelled = function() {
    return (this._target()._bitField & 8454144) !== 0;
};

Promise.prototype.isPending = function() {
    return isPending.call(this._target());
};

Promise.prototype.isRejected = function() {
    return isRejected.call(this._target());
};

Promise.prototype.isFulfilled = function() {
    return isFulfilled.call(this._target());
};

Promise.prototype.isResolved = function() {
    return isResolved.call(this._target());
};

Promise.prototype.value = function() {
    return value.call(this._target());
};

Promise.prototype.reason = function() {
    var target = this._target();
    target._unsetRejectionIsUnhandled();
    return reason.call(target);
};

Promise.prototype._value = function() {
    return this._settledValue();
};

Promise.prototype._reason = function() {
    this._unsetRejectionIsUnhandled();
    return this._settledValue();
};

Promise.PromiseInspection = PromiseInspection;
};


/***/ }),

/***/ 7343:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise, INTERNAL) {
var util = __webpack_require__(95427);
var errorObj = util.errorObj;
var isObject = util.isObject;

function tryConvertToPromise(obj, context) {
    if (isObject(obj)) {
        if (obj instanceof Promise) return obj;
        var then = getThen(obj);
        if (then === errorObj) {
            if (context) context._pushContext();
            var ret = Promise.reject(then.e);
            if (context) context._popContext();
            return ret;
        } else if (typeof then === "function") {
            if (isAnyBluebirdPromise(obj)) {
                var ret = new Promise(INTERNAL);
                obj._then(
                    ret._fulfill,
                    ret._reject,
                    undefined,
                    ret,
                    null
                );
                return ret;
            }
            return doThenable(obj, then, context);
        }
    }
    return obj;
}

function doGetThen(obj) {
    return obj.then;
}

function getThen(obj) {
    try {
        return doGetThen(obj);
    } catch (e) {
        errorObj.e = e;
        return errorObj;
    }
}

var hasProp = {}.hasOwnProperty;
function isAnyBluebirdPromise(obj) {
    try {
        return hasProp.call(obj, "_promise0");
    } catch (e) {
        return false;
    }
}

function doThenable(x, then, context) {
    var promise = new Promise(INTERNAL);
    var ret = promise;
    if (context) context._pushContext();
    promise._captureStackTrace();
    if (context) context._popContext();
    var synchronous = true;
    var result = util.tryCatch(then).call(x, resolve, reject);
    synchronous = false;

    if (promise && result === errorObj) {
        promise._rejectCallback(result.e, true, true);
        promise = null;
    }

    function resolve(value) {
        if (!promise) return;
        promise._resolveCallback(value);
        promise = null;
    }

    function reject(reason) {
        if (!promise) return;
        promise._rejectCallback(reason, synchronous, true);
        promise = null;
    }
    return ret;
}

return tryConvertToPromise;
};


/***/ }),

/***/ 35297:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function(Promise, INTERNAL, debug) {
var util = __webpack_require__(95427);
var TimeoutError = Promise.TimeoutError;

function HandleWrapper(handle)  {
    this.handle = handle;
}

HandleWrapper.prototype._resultCancelled = function() {
    clearTimeout(this.handle);
};

var afterValue = function(value) { return delay(+this).thenReturn(value); };
var delay = Promise.delay = function (ms, value) {
    var ret;
    var handle;
    if (value !== undefined) {
        ret = Promise.resolve(value)
                ._then(afterValue, null, null, ms, undefined);
        if (debug.cancellation() && value instanceof Promise) {
            ret._setOnCancel(value);
        }
    } else {
        ret = new Promise(INTERNAL);
        handle = setTimeout(function() { ret._fulfill(); }, +ms);
        if (debug.cancellation()) {
            ret._setOnCancel(new HandleWrapper(handle));
        }
        ret._captureStackTrace();
    }
    ret._setAsyncGuaranteed();
    return ret;
};

Promise.prototype.delay = function (ms) {
    return delay(ms, this);
};

var afterTimeout = function (promise, message, parent) {
    var err;
    if (typeof message !== "string") {
        if (message instanceof Error) {
            err = message;
        } else {
            err = new TimeoutError("operation timed out");
        }
    } else {
        err = new TimeoutError(message);
    }
    util.markAsOriginatingFromRejection(err);
    promise._attachExtraTrace(err);
    promise._reject(err);

    if (parent != null) {
        parent.cancel();
    }
};

function successClear(value) {
    clearTimeout(this.handle);
    return value;
}

function failureClear(reason) {
    clearTimeout(this.handle);
    throw reason;
}

Promise.prototype.timeout = function (ms, message) {
    ms = +ms;
    var ret, parent;

    var handleWrapper = new HandleWrapper(setTimeout(function timeoutTimeout() {
        if (ret.isPending()) {
            afterTimeout(ret, message, parent);
        }
    }, ms));

    if (debug.cancellation()) {
        parent = this.then();
        ret = parent._then(successClear, failureClear,
                            undefined, handleWrapper, undefined);
        ret._setOnCancel(handleWrapper);
    } else {
        ret = this._then(successClear, failureClear,
                            undefined, handleWrapper, undefined);
    }

    return ret;
};

};


/***/ }),

/***/ 80435:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

module.exports = function (Promise, apiRejection, tryConvertToPromise,
    createContext, INTERNAL, debug) {
    var util = __webpack_require__(95427);
    var TypeError = (__webpack_require__(23828).TypeError);
    var inherits = (__webpack_require__(95427).inherits);
    var errorObj = util.errorObj;
    var tryCatch = util.tryCatch;
    var NULL = {};

    function thrower(e) {
        setTimeout(function(){throw e;}, 0);
    }

    function castPreservingDisposable(thenable) {
        var maybePromise = tryConvertToPromise(thenable);
        if (maybePromise !== thenable &&
            typeof thenable._isDisposable === "function" &&
            typeof thenable._getDisposer === "function" &&
            thenable._isDisposable()) {
            maybePromise._setDisposable(thenable._getDisposer());
        }
        return maybePromise;
    }
    function dispose(resources, inspection) {
        var i = 0;
        var len = resources.length;
        var ret = new Promise(INTERNAL);
        function iterator() {
            if (i >= len) return ret._fulfill();
            var maybePromise = castPreservingDisposable(resources[i++]);
            if (maybePromise instanceof Promise &&
                maybePromise._isDisposable()) {
                try {
                    maybePromise = tryConvertToPromise(
                        maybePromise._getDisposer().tryDispose(inspection),
                        resources.promise);
                } catch (e) {
                    return thrower(e);
                }
                if (maybePromise instanceof Promise) {
                    return maybePromise._then(iterator, thrower,
                                              null, null, null);
                }
            }
            iterator();
        }
        iterator();
        return ret;
    }

    function Disposer(data, promise, context) {
        this._data = data;
        this._promise = promise;
        this._context = context;
    }

    Disposer.prototype.data = function () {
        return this._data;
    };

    Disposer.prototype.promise = function () {
        return this._promise;
    };

    Disposer.prototype.resource = function () {
        if (this.promise().isFulfilled()) {
            return this.promise().value();
        }
        return NULL;
    };

    Disposer.prototype.tryDispose = function(inspection) {
        var resource = this.resource();
        var context = this._context;
        if (context !== undefined) context._pushContext();
        var ret = resource !== NULL
            ? this.doDispose(resource, inspection) : null;
        if (context !== undefined) context._popContext();
        this._promise._unsetDisposable();
        this._data = null;
        return ret;
    };

    Disposer.isDisposer = function (d) {
        return (d != null &&
                typeof d.resource === "function" &&
                typeof d.tryDispose === "function");
    };

    function FunctionDisposer(fn, promise, context) {
        this.constructor$(fn, promise, context);
    }
    inherits(FunctionDisposer, Disposer);

    FunctionDisposer.prototype.doDispose = function (resource, inspection) {
        var fn = this.data();
        return fn.call(resource, resource, inspection);
    };

    function maybeUnwrapDisposer(value) {
        if (Disposer.isDisposer(value)) {
            this.resources[this.index]._setDisposable(value);
            return value.promise();
        }
        return value;
    }

    function ResourceList(length) {
        this.length = length;
        this.promise = null;
        this[length-1] = null;
    }

    ResourceList.prototype._resultCancelled = function() {
        var len = this.length;
        for (var i = 0; i < len; ++i) {
            var item = this[i];
            if (item instanceof Promise) {
                item.cancel();
            }
        }
    };

    Promise.using = function () {
        var len = arguments.length;
        if (len < 2) return apiRejection(
                        "you must pass at least 2 arguments to Promise.using");
        var fn = arguments[len - 1];
        if (typeof fn !== "function") {
            return apiRejection("expecting a function but got " + util.classString(fn));
        }
        var input;
        var spreadArgs = true;
        if (len === 2 && Array.isArray(arguments[0])) {
            input = arguments[0];
            len = input.length;
            spreadArgs = false;
        } else {
            input = arguments;
            len--;
        }
        var resources = new ResourceList(len);
        for (var i = 0; i < len; ++i) {
            var resource = input[i];
            if (Disposer.isDisposer(resource)) {
                var disposer = resource;
                resource = resource.promise();
                resource._setDisposable(disposer);
            } else {
                var maybePromise = tryConvertToPromise(resource);
                if (maybePromise instanceof Promise) {
                    resource =
                        maybePromise._then(maybeUnwrapDisposer, null, null, {
                            resources: resources,
                            index: i
                    }, undefined);
                }
            }
            resources[i] = resource;
        }

        var reflectedResources = new Array(resources.length);
        for (var i = 0; i < reflectedResources.length; ++i) {
            reflectedResources[i] = Promise.resolve(resources[i]).reflect();
        }

        var resultPromise = Promise.all(reflectedResources)
            .then(function(inspections) {
                for (var i = 0; i < inspections.length; ++i) {
                    var inspection = inspections[i];
                    if (inspection.isRejected()) {
                        errorObj.e = inspection.error();
                        return errorObj;
                    } else if (!inspection.isFulfilled()) {
                        resultPromise.cancel();
                        return;
                    }
                    inspections[i] = inspection.value();
                }
                promise._pushContext();

                fn = tryCatch(fn);
                var ret = spreadArgs
                    ? fn.apply(undefined, inspections) : fn(inspections);
                var promiseCreated = promise._popContext();
                debug.checkForgottenReturns(
                    ret, promiseCreated, "Promise.using", promise);
                return ret;
            });

        var promise = resultPromise.lastly(function() {
            var inspection = new Promise.PromiseInspection(resultPromise);
            return dispose(resources, inspection);
        });
        resources.promise = promise;
        promise._setOnCancel(resources);
        return promise;
    };

    Promise.prototype._setDisposable = function (disposer) {
        this._bitField = this._bitField | 131072;
        this._disposer = disposer;
    };

    Promise.prototype._isDisposable = function () {
        return (this._bitField & 131072) > 0;
    };

    Promise.prototype._getDisposer = function () {
        return this._disposer;
    };

    Promise.prototype._unsetDisposable = function () {
        this._bitField = this._bitField & (~131072);
        this._disposer = undefined;
    };

    Promise.prototype.disposer = function (fn) {
        if (typeof fn === "function") {
            return new FunctionDisposer(fn, this, createContext());
        }
        throw new TypeError();
    };

};


/***/ }),

/***/ 95427:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

"use strict";

var es5 = __webpack_require__(28760);
var canEvaluate = typeof navigator == "undefined";

var errorObj = {e: {}};
var tryCatchTarget;
var globalObject = typeof self !== "undefined" ? self :
    typeof window !== "undefined" ? window :
    typeof __webpack_require__.g !== "undefined" ? __webpack_require__.g :
    this !== undefined ? this : null;

function tryCatcher() {
    try {
        var target = tryCatchTarget;
        tryCatchTarget = null;
        return target.apply(this, arguments);
    } catch (e) {
        errorObj.e = e;
        return errorObj;
    }
}
function tryCatch(fn) {
    tryCatchTarget = fn;
    return tryCatcher;
}

var inherits = function(Child, Parent) {
    var hasProp = {}.hasOwnProperty;

    function T() {
        this.constructor = Child;
        this.constructor$ = Parent;
        for (var propertyName in Parent.prototype) {
            if (hasProp.call(Parent.prototype, propertyName) &&
                propertyName.charAt(propertyName.length-1) !== "$"
           ) {
                this[propertyName + "$"] = Parent.prototype[propertyName];
            }
        }
    }
    T.prototype = Parent.prototype;
    Child.prototype = new T();
    return Child.prototype;
};


function isPrimitive(val) {
    return val == null || val === true || val === false ||
        typeof val === "string" || typeof val === "number";

}

function isObject(value) {
    return typeof value === "function" ||
           typeof value === "object" && value !== null;
}

function maybeWrapAsError(maybeError) {
    if (!isPrimitive(maybeError)) return maybeError;

    return new Error(safeToString(maybeError));
}

function withAppended(target, appendee) {
    var len = target.length;
    var ret = new Array(len + 1);
    var i;
    for (i = 0; i < len; ++i) {
        ret[i] = target[i];
    }
    ret[i] = appendee;
    return ret;
}

function getDataPropertyOrDefault(obj, key, defaultValue) {
    if (es5.isES5) {
        var desc = Object.getOwnPropertyDescriptor(obj, key);

        if (desc != null) {
            return desc.get == null && desc.set == null
                    ? desc.value
                    : defaultValue;
        }
    } else {
        return {}.hasOwnProperty.call(obj, key) ? obj[key] : undefined;
    }
}

function notEnumerableProp(obj, name, value) {
    if (isPrimitive(obj)) return obj;
    var descriptor = {
        value: value,
        configurable: true,
        enumerable: false,
        writable: true
    };
    es5.defineProperty(obj, name, descriptor);
    return obj;
}

function thrower(r) {
    throw r;
}

var inheritedDataKeys = (function() {
    var excludedPrototypes = [
        Array.prototype,
        Object.prototype,
        Function.prototype
    ];

    var isExcludedProto = function(val) {
        for (var i = 0; i < excludedPrototypes.length; ++i) {
            if (excludedPrototypes[i] === val) {
                return true;
            }
        }
        return false;
    };

    if (es5.isES5) {
        var getKeys = Object.getOwnPropertyNames;
        return function(obj) {
            var ret = [];
            var visitedKeys = Object.create(null);
            while (obj != null && !isExcludedProto(obj)) {
                var keys;
                try {
                    keys = getKeys(obj);
                } catch (e) {
                    return ret;
                }
                for (var i = 0; i < keys.length; ++i) {
                    var key = keys[i];
                    if (visitedKeys[key]) continue;
                    visitedKeys[key] = true;
                    var desc = Object.getOwnPropertyDescriptor(obj, key);
                    if (desc != null && desc.get == null && desc.set == null) {
                        ret.push(key);
                    }
                }
                obj = es5.getPrototypeOf(obj);
            }
            return ret;
        };
    } else {
        var hasProp = {}.hasOwnProperty;
        return function(obj) {
            if (isExcludedProto(obj)) return [];
            var ret = [];

            /*jshint forin:false */
            enumeration: for (var key in obj) {
                if (hasProp.call(obj, key)) {
                    ret.push(key);
                } else {
                    for (var i = 0; i < excludedPrototypes.length; ++i) {
                        if (hasProp.call(excludedPrototypes[i], key)) {
                            continue enumeration;
                        }
                    }
                    ret.push(key);
                }
            }
            return ret;
        };
    }

})();

var thisAssignmentPattern = /this\s*\.\s*\S+\s*=/;
function isClass(fn) {
    try {
        if (typeof fn === "function") {
            var keys = es5.names(fn.prototype);

            var hasMethods = es5.isES5 && keys.length > 1;
            var hasMethodsOtherThanConstructor = keys.length > 0 &&
                !(keys.length === 1 && keys[0] === "constructor");
            var hasThisAssignmentAndStaticMethods =
                thisAssignmentPattern.test(fn + "") && es5.names(fn).length > 0;

            if (hasMethods || hasMethodsOtherThanConstructor ||
                hasThisAssignmentAndStaticMethods) {
                return true;
            }
        }
        return false;
    } catch (e) {
        return false;
    }
}

function toFastProperties(obj) {
    /*jshint -W027,-W055,-W031*/
    function FakeConstructor() {}
    FakeConstructor.prototype = obj;
    var l = 8;
    while (l--) new FakeConstructor();
    return obj;
    eval(obj);
}

var rident = /^[a-z$_][a-z$_0-9]*$/i;
function isIdentifier(str) {
    return rident.test(str);
}

function filledRange(count, prefix, suffix) {
    var ret = new Array(count);
    for(var i = 0; i < count; ++i) {
        ret[i] = prefix + i + suffix;
    }
    return ret;
}

function safeToString(obj) {
    try {
        return obj + "";
    } catch (e) {
        return "[no string representation]";
    }
}

function isError(obj) {
    return obj !== null &&
           typeof obj === "object" &&
           typeof obj.message === "string" &&
           typeof obj.name === "string";
}

function markAsOriginatingFromRejection(e) {
    try {
        notEnumerableProp(e, "isOperational", true);
    }
    catch(ignore) {}
}

function originatesFromRejection(e) {
    if (e == null) return false;
    return ((e instanceof Error["__BluebirdErrorTypes__"].OperationalError) ||
        e["isOperational"] === true);
}

function canAttachTrace(obj) {
    return isError(obj) && es5.propertyIsWritable(obj, "stack");
}

var ensureErrorObject = (function() {
    if (!("stack" in new Error())) {
        return function(value) {
            if (canAttachTrace(value)) return value;
            try {throw new Error(safeToString(value));}
            catch(err) {return err;}
        };
    } else {
        return function(value) {
            if (canAttachTrace(value)) return value;
            return new Error(safeToString(value));
        };
    }
})();

function classString(obj) {
    return {}.toString.call(obj);
}

function copyDescriptors(from, to, filter) {
    var keys = es5.names(from);
    for (var i = 0; i < keys.length; ++i) {
        var key = keys[i];
        if (filter(key)) {
            try {
                es5.defineProperty(to, key, es5.getDescriptor(from, key));
            } catch (ignore) {}
        }
    }
}

var asArray = function(v) {
    if (es5.isArray(v)) {
        return v;
    }
    return null;
};

if (typeof Symbol !== "undefined" && Symbol.iterator) {
    var ArrayFrom = typeof Array.from === "function" ? function(v) {
        return Array.from(v);
    } : function(v) {
        var ret = [];
        var it = v[Symbol.iterator]();
        var itResult;
        while (!((itResult = it.next()).done)) {
            ret.push(itResult.value);
        }
        return ret;
    };

    asArray = function(v) {
        if (es5.isArray(v)) {
            return v;
        } else if (v != null && typeof v[Symbol.iterator] === "function") {
            return ArrayFrom(v);
        }
        return null;
    };
}

var isNode = typeof process !== "undefined" &&
        classString(process).toLowerCase() === "[object process]";

var hasEnvVariables = typeof process !== "undefined" &&
    typeof ({}) !== "undefined";

function env(key) {
    return hasEnvVariables ? ({})[key] : undefined;
}

function getNativePromise() {
    if (typeof Promise === "function") {
        try {
            var promise = new Promise(function(){});
            if ({}.toString.call(promise) === "[object Promise]") {
                return Promise;
            }
        } catch (e) {}
    }
}

function domainBind(self, cb) {
    return self.bind(cb);
}

var ret = {
    isClass: isClass,
    isIdentifier: isIdentifier,
    inheritedDataKeys: inheritedDataKeys,
    getDataPropertyOrDefault: getDataPropertyOrDefault,
    thrower: thrower,
    isArray: es5.isArray,
    asArray: asArray,
    notEnumerableProp: notEnumerableProp,
    isPrimitive: isPrimitive,
    isObject: isObject,
    isError: isError,
    canEvaluate: canEvaluate,
    errorObj: errorObj,
    tryCatch: tryCatch,
    inherits: inherits,
    withAppended: withAppended,
    maybeWrapAsError: maybeWrapAsError,
    toFastProperties: toFastProperties,
    filledRange: filledRange,
    toString: safeToString,
    canAttachTrace: canAttachTrace,
    ensureErrorObject: ensureErrorObject,
    originatesFromRejection: originatesFromRejection,
    markAsOriginatingFromRejection: markAsOriginatingFromRejection,
    classString: classString,
    copyDescriptors: copyDescriptors,
    hasDevTools: typeof chrome !== "undefined" && chrome &&
                 typeof chrome.loadTimes === "function",
    isNode: isNode,
    hasEnvVariables: hasEnvVariables,
    env: env,
    global: globalObject,
    getNativePromise: getNativePromise,
    domainBind: domainBind
};
ret.isRecentNode = ret.isNode && (function() {
    var version = process.versions.node.split(".").map(Number);
    return (version[0] === 0 && version[1] > 10) || (version[0] > 0);
})();

if (ret.isNode) ret.toFastProperties(process);

try {throw new Error(); } catch (e) {ret.lastLineError = e;}
module.exports = ret;


/***/ }),

/***/ 19228:
/***/ (function(__unused_webpack_module, exports) {

exports.none = Object.create({
    value: function() {
        throw new Error('Called value on none');
    },
    isNone: function() {
        return true;
    },
    isSome: function() {
        return false;
    },
    map: function() {
        return exports.none;
    },
    flatMap: function() {
        return exports.none;
    },
    filter: function() {
        return exports.none;
    },
    toArray: function() {
        return [];
    },
    orElse: callOrReturn,
    valueOrElse: callOrReturn
});

function callOrReturn(value) {
    if (typeof(value) == "function") {
        return value();
    } else {
        return value;
    }
}

exports.some = function(value) {
    return new Some(value);
};

var Some = function(value) {
    this._value = value;
};

Some.prototype.value = function() {
    return this._value;
};

Some.prototype.isNone = function() {
    return false;
};

Some.prototype.isSome = function() {
    return true;
};

Some.prototype.map = function(func) {
    return new Some(func(this._value));
};

Some.prototype.flatMap = function(func) {
    return func(this._value);
};

Some.prototype.filter = function(predicate) {
    return predicate(this._value) ? this : exports.none;
};

Some.prototype.toArray = function() {
    return [this._value];
};

Some.prototype.orElse = function(value) {
    return this;
};

Some.prototype.valueOrElse = function(value) {
    return this._value;
};

exports.isOption = function(value) {
    return value === exports.none || value instanceof Some;
};

exports.fromNullable = function(value) {
    if (value == null) {
        return exports.none;
    }
    return new Some(value);
}


/***/ }),

/***/ 49241:
/***/ (function(module) {

// Generated by CoffeeScript 1.12.7
(function() {
  var assign, getValue, isArray, isEmpty, isFunction, isObject, isPlainObject,
    slice = [].slice,
    hasProp = {}.hasOwnProperty;

  assign = function() {
    var i, key, len, source, sources, target;
    target = arguments[0], sources = 2 <= arguments.length ? slice.call(arguments, 1) : [];
    if (isFunction(Object.assign)) {
      Object.assign.apply(null, arguments);
    } else {
      for (i = 0, len = sources.length; i < len; i++) {
        source = sources[i];
        if (source != null) {
          for (key in source) {
            if (!hasProp.call(source, key)) continue;
            target[key] = source[key];
          }
        }
      }
    }
    return target;
  };

  isFunction = function(val) {
    return !!val && Object.prototype.toString.call(val) === '[object Function]';
  };

  isObject = function(val) {
    var ref;
    return !!val && ((ref = typeof val) === 'function' || ref === 'object');
  };

  isArray = function(val) {
    if (isFunction(Array.isArray)) {
      return Array.isArray(val);
    } else {
      return Object.prototype.toString.call(val) === '[object Array]';
    }
  };

  isEmpty = function(val) {
    var key;
    if (isArray(val)) {
      return !val.length;
    } else {
      for (key in val) {
        if (!hasProp.call(val, key)) continue;
        return false;
      }
      return true;
    }
  };

  isPlainObject = function(val) {
    var ctor, proto;
    return isObject(val) && (proto = Object.getPrototypeOf(val)) && (ctor = proto.constructor) && (typeof ctor === 'function') && (ctor instanceof ctor) && (Function.prototype.toString.call(ctor) === Function.prototype.toString.call(Object));
  };

  getValue = function(obj) {
    if (isFunction(obj.valueOf)) {
      return obj.valueOf();
    } else {
      return obj;
    }
  };

  module.exports.assign = assign;

  module.exports.isFunction = isFunction;

  module.exports.isObject = isObject;

  module.exports.isArray = isArray;

  module.exports.isEmpty = isEmpty;

  module.exports.isPlainObject = isPlainObject;

  module.exports.getValue = getValue;

}).call(this);


/***/ }),

/***/ 54238:
/***/ (function(module) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLAttribute;

  module.exports = XMLAttribute = (function() {
    function XMLAttribute(parent, name, value) {
      this.options = parent.options;
      this.stringify = parent.stringify;
      this.parent = parent;
      if (name == null) {
        throw new Error("Missing attribute name. " + this.debugInfo(name));
      }
      if (value == null) {
        throw new Error("Missing attribute value. " + this.debugInfo(name));
      }
      this.name = this.stringify.attName(name);
      this.value = this.stringify.attValue(value);
    }

    XMLAttribute.prototype.clone = function() {
      return Object.create(this);
    };

    XMLAttribute.prototype.toString = function(options) {
      return this.options.writer.set(options).attribute(this);
    };

    XMLAttribute.prototype.debugInfo = function(name) {
      name = name || this.name;
      if (name == null) {
        return "parent: <" + this.parent.name + ">";
      } else {
        return "attribute: {" + name + "}, parent: <" + this.parent.name + ">";
      }
    };

    return XMLAttribute;

  })();

}).call(this);


/***/ }),

/***/ 92691:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLCData, XMLNode,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLNode = __webpack_require__(10468);

  module.exports = XMLCData = (function(superClass) {
    extend(XMLCData, superClass);

    function XMLCData(parent, text) {
      XMLCData.__super__.constructor.call(this, parent);
      if (text == null) {
        throw new Error("Missing CDATA text. " + this.debugInfo());
      }
      this.text = this.stringify.cdata(text);
    }

    XMLCData.prototype.clone = function() {
      return Object.create(this);
    };

    XMLCData.prototype.toString = function(options) {
      return this.options.writer.set(options).cdata(this);
    };

    return XMLCData;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 32679:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLComment, XMLNode,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLNode = __webpack_require__(10468);

  module.exports = XMLComment = (function(superClass) {
    extend(XMLComment, superClass);

    function XMLComment(parent, text) {
      XMLComment.__super__.constructor.call(this, parent);
      if (text == null) {
        throw new Error("Missing comment text. " + this.debugInfo());
      }
      this.text = this.stringify.comment(text);
    }

    XMLComment.prototype.clone = function() {
      return Object.create(this);
    };

    XMLComment.prototype.toString = function(options) {
      return this.options.writer.set(options).comment(this);
    };

    return XMLComment;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 34111:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLDTDAttList, XMLNode,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLNode = __webpack_require__(10468);

  module.exports = XMLDTDAttList = (function(superClass) {
    extend(XMLDTDAttList, superClass);

    function XMLDTDAttList(parent, elementName, attributeName, attributeType, defaultValueType, defaultValue) {
      XMLDTDAttList.__super__.constructor.call(this, parent);
      if (elementName == null) {
        throw new Error("Missing DTD element name. " + this.debugInfo());
      }
      if (attributeName == null) {
        throw new Error("Missing DTD attribute name. " + this.debugInfo(elementName));
      }
      if (!attributeType) {
        throw new Error("Missing DTD attribute type. " + this.debugInfo(elementName));
      }
      if (!defaultValueType) {
        throw new Error("Missing DTD attribute default. " + this.debugInfo(elementName));
      }
      if (defaultValueType.indexOf('#') !== 0) {
        defaultValueType = '#' + defaultValueType;
      }
      if (!defaultValueType.match(/^(#REQUIRED|#IMPLIED|#FIXED|#DEFAULT)$/)) {
        throw new Error("Invalid default value type; expected: #REQUIRED, #IMPLIED, #FIXED or #DEFAULT. " + this.debugInfo(elementName));
      }
      if (defaultValue && !defaultValueType.match(/^(#FIXED|#DEFAULT)$/)) {
        throw new Error("Default value only applies to #FIXED or #DEFAULT. " + this.debugInfo(elementName));
      }
      this.elementName = this.stringify.eleName(elementName);
      this.attributeName = this.stringify.attName(attributeName);
      this.attributeType = this.stringify.dtdAttType(attributeType);
      this.defaultValue = this.stringify.dtdAttDefault(defaultValue);
      this.defaultValueType = defaultValueType;
    }

    XMLDTDAttList.prototype.toString = function(options) {
      return this.options.writer.set(options).dtdAttList(this);
    };

    return XMLDTDAttList;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 67696:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLDTDElement, XMLNode,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLNode = __webpack_require__(10468);

  module.exports = XMLDTDElement = (function(superClass) {
    extend(XMLDTDElement, superClass);

    function XMLDTDElement(parent, name, value) {
      XMLDTDElement.__super__.constructor.call(this, parent);
      if (name == null) {
        throw new Error("Missing DTD element name. " + this.debugInfo());
      }
      if (!value) {
        value = '(#PCDATA)';
      }
      if (Array.isArray(value)) {
        value = '(' + value.join(',') + ')';
      }
      this.name = this.stringify.eleName(name);
      this.value = this.stringify.dtdElementValue(value);
    }

    XMLDTDElement.prototype.toString = function(options) {
      return this.options.writer.set(options).dtdElement(this);
    };

    return XMLDTDElement;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 5529:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLDTDEntity, XMLNode, isObject,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  isObject = (__webpack_require__(49241).isObject);

  XMLNode = __webpack_require__(10468);

  module.exports = XMLDTDEntity = (function(superClass) {
    extend(XMLDTDEntity, superClass);

    function XMLDTDEntity(parent, pe, name, value) {
      XMLDTDEntity.__super__.constructor.call(this, parent);
      if (name == null) {
        throw new Error("Missing DTD entity name. " + this.debugInfo(name));
      }
      if (value == null) {
        throw new Error("Missing DTD entity value. " + this.debugInfo(name));
      }
      this.pe = !!pe;
      this.name = this.stringify.eleName(name);
      if (!isObject(value)) {
        this.value = this.stringify.dtdEntityValue(value);
      } else {
        if (!value.pubID && !value.sysID) {
          throw new Error("Public and/or system identifiers are required for an external entity. " + this.debugInfo(name));
        }
        if (value.pubID && !value.sysID) {
          throw new Error("System identifier is required for a public external entity. " + this.debugInfo(name));
        }
        if (value.pubID != null) {
          this.pubID = this.stringify.dtdPubID(value.pubID);
        }
        if (value.sysID != null) {
          this.sysID = this.stringify.dtdSysID(value.sysID);
        }
        if (value.nData != null) {
          this.nData = this.stringify.dtdNData(value.nData);
        }
        if (this.pe && this.nData) {
          throw new Error("Notation declaration is not allowed in a parameter entity. " + this.debugInfo(name));
        }
      }
    }

    XMLDTDEntity.prototype.toString = function(options) {
      return this.options.writer.set(options).dtdEntity(this);
    };

    return XMLDTDEntity;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 28012:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLDTDNotation, XMLNode,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLNode = __webpack_require__(10468);

  module.exports = XMLDTDNotation = (function(superClass) {
    extend(XMLDTDNotation, superClass);

    function XMLDTDNotation(parent, name, value) {
      XMLDTDNotation.__super__.constructor.call(this, parent);
      if (name == null) {
        throw new Error("Missing DTD notation name. " + this.debugInfo(name));
      }
      if (!value.pubID && !value.sysID) {
        throw new Error("Public or system identifiers are required for an external entity. " + this.debugInfo(name));
      }
      this.name = this.stringify.eleName(name);
      if (value.pubID != null) {
        this.pubID = this.stringify.dtdPubID(value.pubID);
      }
      if (value.sysID != null) {
        this.sysID = this.stringify.dtdSysID(value.sysID);
      }
    }

    XMLDTDNotation.prototype.toString = function(options) {
      return this.options.writer.set(options).dtdNotation(this);
    };

    return XMLDTDNotation;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 34130:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLDeclaration, XMLNode, isObject,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  isObject = (__webpack_require__(49241).isObject);

  XMLNode = __webpack_require__(10468);

  module.exports = XMLDeclaration = (function(superClass) {
    extend(XMLDeclaration, superClass);

    function XMLDeclaration(parent, version, encoding, standalone) {
      var ref;
      XMLDeclaration.__super__.constructor.call(this, parent);
      if (isObject(version)) {
        ref = version, version = ref.version, encoding = ref.encoding, standalone = ref.standalone;
      }
      if (!version) {
        version = '1.0';
      }
      this.version = this.stringify.xmlVersion(version);
      if (encoding != null) {
        this.encoding = this.stringify.xmlEncoding(encoding);
      }
      if (standalone != null) {
        this.standalone = this.stringify.xmlStandalone(standalone);
      }
    }

    XMLDeclaration.prototype.toString = function(options) {
      return this.options.writer.set(options).declaration(this);
    };

    return XMLDeclaration;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 96376:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLDTDAttList, XMLDTDElement, XMLDTDEntity, XMLDTDNotation, XMLDocType, XMLNode, isObject,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  isObject = (__webpack_require__(49241).isObject);

  XMLNode = __webpack_require__(10468);

  XMLDTDAttList = __webpack_require__(34111);

  XMLDTDEntity = __webpack_require__(5529);

  XMLDTDElement = __webpack_require__(67696);

  XMLDTDNotation = __webpack_require__(28012);

  module.exports = XMLDocType = (function(superClass) {
    extend(XMLDocType, superClass);

    function XMLDocType(parent, pubID, sysID) {
      var ref, ref1;
      XMLDocType.__super__.constructor.call(this, parent);
      this.name = "!DOCTYPE";
      this.documentObject = parent;
      if (isObject(pubID)) {
        ref = pubID, pubID = ref.pubID, sysID = ref.sysID;
      }
      if (sysID == null) {
        ref1 = [pubID, sysID], sysID = ref1[0], pubID = ref1[1];
      }
      if (pubID != null) {
        this.pubID = this.stringify.dtdPubID(pubID);
      }
      if (sysID != null) {
        this.sysID = this.stringify.dtdSysID(sysID);
      }
    }

    XMLDocType.prototype.element = function(name, value) {
      var child;
      child = new XMLDTDElement(this, name, value);
      this.children.push(child);
      return this;
    };

    XMLDocType.prototype.attList = function(elementName, attributeName, attributeType, defaultValueType, defaultValue) {
      var child;
      child = new XMLDTDAttList(this, elementName, attributeName, attributeType, defaultValueType, defaultValue);
      this.children.push(child);
      return this;
    };

    XMLDocType.prototype.entity = function(name, value) {
      var child;
      child = new XMLDTDEntity(this, false, name, value);
      this.children.push(child);
      return this;
    };

    XMLDocType.prototype.pEntity = function(name, value) {
      var child;
      child = new XMLDTDEntity(this, true, name, value);
      this.children.push(child);
      return this;
    };

    XMLDocType.prototype.notation = function(name, value) {
      var child;
      child = new XMLDTDNotation(this, name, value);
      this.children.push(child);
      return this;
    };

    XMLDocType.prototype.toString = function(options) {
      return this.options.writer.set(options).docType(this);
    };

    XMLDocType.prototype.ele = function(name, value) {
      return this.element(name, value);
    };

    XMLDocType.prototype.att = function(elementName, attributeName, attributeType, defaultValueType, defaultValue) {
      return this.attList(elementName, attributeName, attributeType, defaultValueType, defaultValue);
    };

    XMLDocType.prototype.ent = function(name, value) {
      return this.entity(name, value);
    };

    XMLDocType.prototype.pent = function(name, value) {
      return this.pEntity(name, value);
    };

    XMLDocType.prototype.not = function(name, value) {
      return this.notation(name, value);
    };

    XMLDocType.prototype.up = function() {
      return this.root() || this.documentObject;
    };

    return XMLDocType;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 71933:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLDocument, XMLNode, XMLStringWriter, XMLStringifier, isPlainObject,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  isPlainObject = (__webpack_require__(49241).isPlainObject);

  XMLNode = __webpack_require__(10468);

  XMLStringifier = __webpack_require__(43976);

  XMLStringWriter = __webpack_require__(40382);

  module.exports = XMLDocument = (function(superClass) {
    extend(XMLDocument, superClass);

    function XMLDocument(options) {
      XMLDocument.__super__.constructor.call(this, null);
      this.name = "?xml";
      options || (options = {});
      if (!options.writer) {
        options.writer = new XMLStringWriter();
      }
      this.options = options;
      this.stringify = new XMLStringifier(options);
      this.isDocument = true;
    }

    XMLDocument.prototype.end = function(writer) {
      var writerOptions;
      if (!writer) {
        writer = this.options.writer;
      } else if (isPlainObject(writer)) {
        writerOptions = writer;
        writer = this.options.writer.set(writerOptions);
      }
      return writer.document(this);
    };

    XMLDocument.prototype.toString = function(options) {
      return this.options.writer.set(options).document(this);
    };

    return XMLDocument;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 80400:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLAttribute, XMLCData, XMLComment, XMLDTDAttList, XMLDTDElement, XMLDTDEntity, XMLDTDNotation, XMLDeclaration, XMLDocType, XMLDocumentCB, XMLElement, XMLProcessingInstruction, XMLRaw, XMLStringWriter, XMLStringifier, XMLText, getValue, isFunction, isObject, isPlainObject, ref,
    hasProp = {}.hasOwnProperty;

  ref = __webpack_require__(49241), isObject = ref.isObject, isFunction = ref.isFunction, isPlainObject = ref.isPlainObject, getValue = ref.getValue;

  XMLElement = __webpack_require__(33906);

  XMLCData = __webpack_require__(92691);

  XMLComment = __webpack_require__(32679);

  XMLRaw = __webpack_require__(1268);

  XMLText = __webpack_require__(82535);

  XMLProcessingInstruction = __webpack_require__(85915);

  XMLDeclaration = __webpack_require__(34130);

  XMLDocType = __webpack_require__(96376);

  XMLDTDAttList = __webpack_require__(34111);

  XMLDTDEntity = __webpack_require__(5529);

  XMLDTDElement = __webpack_require__(67696);

  XMLDTDNotation = __webpack_require__(28012);

  XMLAttribute = __webpack_require__(54238);

  XMLStringifier = __webpack_require__(43976);

  XMLStringWriter = __webpack_require__(40382);

  module.exports = XMLDocumentCB = (function() {
    function XMLDocumentCB(options, onData, onEnd) {
      var writerOptions;
      this.name = "?xml";
      options || (options = {});
      if (!options.writer) {
        options.writer = new XMLStringWriter(options);
      } else if (isPlainObject(options.writer)) {
        writerOptions = options.writer;
        options.writer = new XMLStringWriter(writerOptions);
      }
      this.options = options;
      this.writer = options.writer;
      this.stringify = new XMLStringifier(options);
      this.onDataCallback = onData || function() {};
      this.onEndCallback = onEnd || function() {};
      this.currentNode = null;
      this.currentLevel = -1;
      this.openTags = {};
      this.documentStarted = false;
      this.documentCompleted = false;
      this.root = null;
    }

    XMLDocumentCB.prototype.node = function(name, attributes, text) {
      var ref1, ref2;
      if (name == null) {
        throw new Error("Missing node name.");
      }
      if (this.root && this.currentLevel === -1) {
        throw new Error("Document can only have one root node. " + this.debugInfo(name));
      }
      this.openCurrent();
      name = getValue(name);
      if (attributes === null && (text == null)) {
        ref1 = [{}, null], attributes = ref1[0], text = ref1[1];
      }
      if (attributes == null) {
        attributes = {};
      }
      attributes = getValue(attributes);
      if (!isObject(attributes)) {
        ref2 = [attributes, text], text = ref2[0], attributes = ref2[1];
      }
      this.currentNode = new XMLElement(this, name, attributes);
      this.currentNode.children = false;
      this.currentLevel++;
      this.openTags[this.currentLevel] = this.currentNode;
      if (text != null) {
        this.text(text);
      }
      return this;
    };

    XMLDocumentCB.prototype.element = function(name, attributes, text) {
      if (this.currentNode && this.currentNode instanceof XMLDocType) {
        return this.dtdElement.apply(this, arguments);
      } else {
        return this.node(name, attributes, text);
      }
    };

    XMLDocumentCB.prototype.attribute = function(name, value) {
      var attName, attValue;
      if (!this.currentNode || this.currentNode.children) {
        throw new Error("att() can only be used immediately after an ele() call in callback mode. " + this.debugInfo(name));
      }
      if (name != null) {
        name = getValue(name);
      }
      if (isObject(name)) {
        for (attName in name) {
          if (!hasProp.call(name, attName)) continue;
          attValue = name[attName];
          this.attribute(attName, attValue);
        }
      } else {
        if (isFunction(value)) {
          value = value.apply();
        }
        if (!this.options.skipNullAttributes || (value != null)) {
          this.currentNode.attributes[name] = new XMLAttribute(this, name, value);
        }
      }
      return this;
    };

    XMLDocumentCB.prototype.text = function(value) {
      var node;
      this.openCurrent();
      node = new XMLText(this, value);
      this.onData(this.writer.text(node, this.currentLevel + 1), this.currentLevel + 1);
      return this;
    };

    XMLDocumentCB.prototype.cdata = function(value) {
      var node;
      this.openCurrent();
      node = new XMLCData(this, value);
      this.onData(this.writer.cdata(node, this.currentLevel + 1), this.currentLevel + 1);
      return this;
    };

    XMLDocumentCB.prototype.comment = function(value) {
      var node;
      this.openCurrent();
      node = new XMLComment(this, value);
      this.onData(this.writer.comment(node, this.currentLevel + 1), this.currentLevel + 1);
      return this;
    };

    XMLDocumentCB.prototype.raw = function(value) {
      var node;
      this.openCurrent();
      node = new XMLRaw(this, value);
      this.onData(this.writer.raw(node, this.currentLevel + 1), this.currentLevel + 1);
      return this;
    };

    XMLDocumentCB.prototype.instruction = function(target, value) {
      var i, insTarget, insValue, len, node;
      this.openCurrent();
      if (target != null) {
        target = getValue(target);
      }
      if (value != null) {
        value = getValue(value);
      }
      if (Array.isArray(target)) {
        for (i = 0, len = target.length; i < len; i++) {
          insTarget = target[i];
          this.instruction(insTarget);
        }
      } else if (isObject(target)) {
        for (insTarget in target) {
          if (!hasProp.call(target, insTarget)) continue;
          insValue = target[insTarget];
          this.instruction(insTarget, insValue);
        }
      } else {
        if (isFunction(value)) {
          value = value.apply();
        }
        node = new XMLProcessingInstruction(this, target, value);
        this.onData(this.writer.processingInstruction(node, this.currentLevel + 1), this.currentLevel + 1);
      }
      return this;
    };

    XMLDocumentCB.prototype.declaration = function(version, encoding, standalone) {
      var node;
      this.openCurrent();
      if (this.documentStarted) {
        throw new Error("declaration() must be the first node.");
      }
      node = new XMLDeclaration(this, version, encoding, standalone);
      this.onData(this.writer.declaration(node, this.currentLevel + 1), this.currentLevel + 1);
      return this;
    };

    XMLDocumentCB.prototype.doctype = function(root, pubID, sysID) {
      this.openCurrent();
      if (root == null) {
        throw new Error("Missing root node name.");
      }
      if (this.root) {
        throw new Error("dtd() must come before the root node.");
      }
      this.currentNode = new XMLDocType(this, pubID, sysID);
      this.currentNode.rootNodeName = root;
      this.currentNode.children = false;
      this.currentLevel++;
      this.openTags[this.currentLevel] = this.currentNode;
      return this;
    };

    XMLDocumentCB.prototype.dtdElement = function(name, value) {
      var node;
      this.openCurrent();
      node = new XMLDTDElement(this, name, value);
      this.onData(this.writer.dtdElement(node, this.currentLevel + 1), this.currentLevel + 1);
      return this;
    };

    XMLDocumentCB.prototype.attList = function(elementName, attributeName, attributeType, defaultValueType, defaultValue) {
      var node;
      this.openCurrent();
      node = new XMLDTDAttList(this, elementName, attributeName, attributeType, defaultValueType, defaultValue);
      this.onData(this.writer.dtdAttList(node, this.currentLevel + 1), this.currentLevel + 1);
      return this;
    };

    XMLDocumentCB.prototype.entity = function(name, value) {
      var node;
      this.openCurrent();
      node = new XMLDTDEntity(this, false, name, value);
      this.onData(this.writer.dtdEntity(node, this.currentLevel + 1), this.currentLevel + 1);
      return this;
    };

    XMLDocumentCB.prototype.pEntity = function(name, value) {
      var node;
      this.openCurrent();
      node = new XMLDTDEntity(this, true, name, value);
      this.onData(this.writer.dtdEntity(node, this.currentLevel + 1), this.currentLevel + 1);
      return this;
    };

    XMLDocumentCB.prototype.notation = function(name, value) {
      var node;
      this.openCurrent();
      node = new XMLDTDNotation(this, name, value);
      this.onData(this.writer.dtdNotation(node, this.currentLevel + 1), this.currentLevel + 1);
      return this;
    };

    XMLDocumentCB.prototype.up = function() {
      if (this.currentLevel < 0) {
        throw new Error("The document node has no parent.");
      }
      if (this.currentNode) {
        if (this.currentNode.children) {
          this.closeNode(this.currentNode);
        } else {
          this.openNode(this.currentNode);
        }
        this.currentNode = null;
      } else {
        this.closeNode(this.openTags[this.currentLevel]);
      }
      delete this.openTags[this.currentLevel];
      this.currentLevel--;
      return this;
    };

    XMLDocumentCB.prototype.end = function() {
      while (this.currentLevel >= 0) {
        this.up();
      }
      return this.onEnd();
    };

    XMLDocumentCB.prototype.openCurrent = function() {
      if (this.currentNode) {
        this.currentNode.children = true;
        return this.openNode(this.currentNode);
      }
    };

    XMLDocumentCB.prototype.openNode = function(node) {
      if (!node.isOpen) {
        if (!this.root && this.currentLevel === 0 && node instanceof XMLElement) {
          this.root = node;
        }
        this.onData(this.writer.openNode(node, this.currentLevel), this.currentLevel);
        return node.isOpen = true;
      }
    };

    XMLDocumentCB.prototype.closeNode = function(node) {
      if (!node.isClosed) {
        this.onData(this.writer.closeNode(node, this.currentLevel), this.currentLevel);
        return node.isClosed = true;
      }
    };

    XMLDocumentCB.prototype.onData = function(chunk, level) {
      this.documentStarted = true;
      return this.onDataCallback(chunk, level + 1);
    };

    XMLDocumentCB.prototype.onEnd = function() {
      this.documentCompleted = true;
      return this.onEndCallback();
    };

    XMLDocumentCB.prototype.debugInfo = function(name) {
      if (name == null) {
        return "";
      } else {
        return "node: <" + name + ">";
      }
    };

    XMLDocumentCB.prototype.ele = function() {
      return this.element.apply(this, arguments);
    };

    XMLDocumentCB.prototype.nod = function(name, attributes, text) {
      return this.node(name, attributes, text);
    };

    XMLDocumentCB.prototype.txt = function(value) {
      return this.text(value);
    };

    XMLDocumentCB.prototype.dat = function(value) {
      return this.cdata(value);
    };

    XMLDocumentCB.prototype.com = function(value) {
      return this.comment(value);
    };

    XMLDocumentCB.prototype.ins = function(target, value) {
      return this.instruction(target, value);
    };

    XMLDocumentCB.prototype.dec = function(version, encoding, standalone) {
      return this.declaration(version, encoding, standalone);
    };

    XMLDocumentCB.prototype.dtd = function(root, pubID, sysID) {
      return this.doctype(root, pubID, sysID);
    };

    XMLDocumentCB.prototype.e = function(name, attributes, text) {
      return this.element(name, attributes, text);
    };

    XMLDocumentCB.prototype.n = function(name, attributes, text) {
      return this.node(name, attributes, text);
    };

    XMLDocumentCB.prototype.t = function(value) {
      return this.text(value);
    };

    XMLDocumentCB.prototype.d = function(value) {
      return this.cdata(value);
    };

    XMLDocumentCB.prototype.c = function(value) {
      return this.comment(value);
    };

    XMLDocumentCB.prototype.r = function(value) {
      return this.raw(value);
    };

    XMLDocumentCB.prototype.i = function(target, value) {
      return this.instruction(target, value);
    };

    XMLDocumentCB.prototype.att = function() {
      if (this.currentNode && this.currentNode instanceof XMLDocType) {
        return this.attList.apply(this, arguments);
      } else {
        return this.attribute.apply(this, arguments);
      }
    };

    XMLDocumentCB.prototype.a = function() {
      if (this.currentNode && this.currentNode instanceof XMLDocType) {
        return this.attList.apply(this, arguments);
      } else {
        return this.attribute.apply(this, arguments);
      }
    };

    XMLDocumentCB.prototype.ent = function(name, value) {
      return this.entity(name, value);
    };

    XMLDocumentCB.prototype.pent = function(name, value) {
      return this.pEntity(name, value);
    };

    XMLDocumentCB.prototype.not = function(name, value) {
      return this.notation(name, value);
    };

    return XMLDocumentCB;

  })();

}).call(this);


/***/ }),

/***/ 21218:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLDummy, XMLNode,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLNode = __webpack_require__(10468);

  module.exports = XMLDummy = (function(superClass) {
    extend(XMLDummy, superClass);

    function XMLDummy(parent) {
      XMLDummy.__super__.constructor.call(this, parent);
      this.isDummy = true;
    }

    XMLDummy.prototype.clone = function() {
      return Object.create(this);
    };

    XMLDummy.prototype.toString = function(options) {
      return '';
    };

    return XMLDummy;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 33906:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLAttribute, XMLElement, XMLNode, getValue, isFunction, isObject, ref,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  ref = __webpack_require__(49241), isObject = ref.isObject, isFunction = ref.isFunction, getValue = ref.getValue;

  XMLNode = __webpack_require__(10468);

  XMLAttribute = __webpack_require__(54238);

  module.exports = XMLElement = (function(superClass) {
    extend(XMLElement, superClass);

    function XMLElement(parent, name, attributes) {
      XMLElement.__super__.constructor.call(this, parent);
      if (name == null) {
        throw new Error("Missing element name. " + this.debugInfo());
      }
      this.name = this.stringify.eleName(name);
      this.attributes = {};
      if (attributes != null) {
        this.attribute(attributes);
      }
      if (parent.isDocument) {
        this.isRoot = true;
        this.documentObject = parent;
        parent.rootObject = this;
      }
    }

    XMLElement.prototype.clone = function() {
      var att, attName, clonedSelf, ref1;
      clonedSelf = Object.create(this);
      if (clonedSelf.isRoot) {
        clonedSelf.documentObject = null;
      }
      clonedSelf.attributes = {};
      ref1 = this.attributes;
      for (attName in ref1) {
        if (!hasProp.call(ref1, attName)) continue;
        att = ref1[attName];
        clonedSelf.attributes[attName] = att.clone();
      }
      clonedSelf.children = [];
      this.children.forEach(function(child) {
        var clonedChild;
        clonedChild = child.clone();
        clonedChild.parent = clonedSelf;
        return clonedSelf.children.push(clonedChild);
      });
      return clonedSelf;
    };

    XMLElement.prototype.attribute = function(name, value) {
      var attName, attValue;
      if (name != null) {
        name = getValue(name);
      }
      if (isObject(name)) {
        for (attName in name) {
          if (!hasProp.call(name, attName)) continue;
          attValue = name[attName];
          this.attribute(attName, attValue);
        }
      } else {
        if (isFunction(value)) {
          value = value.apply();
        }
        if (!this.options.skipNullAttributes || (value != null)) {
          this.attributes[name] = new XMLAttribute(this, name, value);
        }
      }
      return this;
    };

    XMLElement.prototype.removeAttribute = function(name) {
      var attName, i, len;
      if (name == null) {
        throw new Error("Missing attribute name. " + this.debugInfo());
      }
      name = getValue(name);
      if (Array.isArray(name)) {
        for (i = 0, len = name.length; i < len; i++) {
          attName = name[i];
          delete this.attributes[attName];
        }
      } else {
        delete this.attributes[name];
      }
      return this;
    };

    XMLElement.prototype.toString = function(options) {
      return this.options.writer.set(options).element(this);
    };

    XMLElement.prototype.att = function(name, value) {
      return this.attribute(name, value);
    };

    XMLElement.prototype.a = function(name, value) {
      return this.attribute(name, value);
    };

    return XMLElement;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 10468:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLCData, XMLComment, XMLDeclaration, XMLDocType, XMLDummy, XMLElement, XMLNode, XMLProcessingInstruction, XMLRaw, XMLText, getValue, isEmpty, isFunction, isObject, ref,
    hasProp = {}.hasOwnProperty;

  ref = __webpack_require__(49241), isObject = ref.isObject, isFunction = ref.isFunction, isEmpty = ref.isEmpty, getValue = ref.getValue;

  XMLElement = null;

  XMLCData = null;

  XMLComment = null;

  XMLDeclaration = null;

  XMLDocType = null;

  XMLRaw = null;

  XMLText = null;

  XMLProcessingInstruction = null;

  XMLDummy = null;

  module.exports = XMLNode = (function() {
    function XMLNode(parent) {
      this.parent = parent;
      if (this.parent) {
        this.options = this.parent.options;
        this.stringify = this.parent.stringify;
      }
      this.children = [];
      if (!XMLElement) {
        XMLElement = __webpack_require__(33906);
        XMLCData = __webpack_require__(92691);
        XMLComment = __webpack_require__(32679);
        XMLDeclaration = __webpack_require__(34130);
        XMLDocType = __webpack_require__(96376);
        XMLRaw = __webpack_require__(1268);
        XMLText = __webpack_require__(82535);
        XMLProcessingInstruction = __webpack_require__(85915);
        XMLDummy = __webpack_require__(21218);
      }
    }

    XMLNode.prototype.element = function(name, attributes, text) {
      var childNode, item, j, k, key, lastChild, len, len1, ref1, ref2, val;
      lastChild = null;
      if (attributes === null && (text == null)) {
        ref1 = [{}, null], attributes = ref1[0], text = ref1[1];
      }
      if (attributes == null) {
        attributes = {};
      }
      attributes = getValue(attributes);
      if (!isObject(attributes)) {
        ref2 = [attributes, text], text = ref2[0], attributes = ref2[1];
      }
      if (name != null) {
        name = getValue(name);
      }
      if (Array.isArray(name)) {
        for (j = 0, len = name.length; j < len; j++) {
          item = name[j];
          lastChild = this.element(item);
        }
      } else if (isFunction(name)) {
        lastChild = this.element(name.apply());
      } else if (isObject(name)) {
        for (key in name) {
          if (!hasProp.call(name, key)) continue;
          val = name[key];
          if (isFunction(val)) {
            val = val.apply();
          }
          if ((isObject(val)) && (isEmpty(val))) {
            val = null;
          }
          if (!this.options.ignoreDecorators && this.stringify.convertAttKey && key.indexOf(this.stringify.convertAttKey) === 0) {
            lastChild = this.attribute(key.substr(this.stringify.convertAttKey.length), val);
          } else if (!this.options.separateArrayItems && Array.isArray(val)) {
            for (k = 0, len1 = val.length; k < len1; k++) {
              item = val[k];
              childNode = {};
              childNode[key] = item;
              lastChild = this.element(childNode);
            }
          } else if (isObject(val)) {
            lastChild = this.element(key);
            lastChild.element(val);
          } else {
            lastChild = this.element(key, val);
          }
        }
      } else if (this.options.skipNullNodes && text === null) {
        lastChild = this.dummy();
      } else {
        if (!this.options.ignoreDecorators && this.stringify.convertTextKey && name.indexOf(this.stringify.convertTextKey) === 0) {
          lastChild = this.text(text);
        } else if (!this.options.ignoreDecorators && this.stringify.convertCDataKey && name.indexOf(this.stringify.convertCDataKey) === 0) {
          lastChild = this.cdata(text);
        } else if (!this.options.ignoreDecorators && this.stringify.convertCommentKey && name.indexOf(this.stringify.convertCommentKey) === 0) {
          lastChild = this.comment(text);
        } else if (!this.options.ignoreDecorators && this.stringify.convertRawKey && name.indexOf(this.stringify.convertRawKey) === 0) {
          lastChild = this.raw(text);
        } else if (!this.options.ignoreDecorators && this.stringify.convertPIKey && name.indexOf(this.stringify.convertPIKey) === 0) {
          lastChild = this.instruction(name.substr(this.stringify.convertPIKey.length), text);
        } else {
          lastChild = this.node(name, attributes, text);
        }
      }
      if (lastChild == null) {
        throw new Error("Could not create any elements with: " + name + ". " + this.debugInfo());
      }
      return lastChild;
    };

    XMLNode.prototype.insertBefore = function(name, attributes, text) {
      var child, i, removed;
      if (this.isRoot) {
        throw new Error("Cannot insert elements at root level. " + this.debugInfo(name));
      }
      i = this.parent.children.indexOf(this);
      removed = this.parent.children.splice(i);
      child = this.parent.element(name, attributes, text);
      Array.prototype.push.apply(this.parent.children, removed);
      return child;
    };

    XMLNode.prototype.insertAfter = function(name, attributes, text) {
      var child, i, removed;
      if (this.isRoot) {
        throw new Error("Cannot insert elements at root level. " + this.debugInfo(name));
      }
      i = this.parent.children.indexOf(this);
      removed = this.parent.children.splice(i + 1);
      child = this.parent.element(name, attributes, text);
      Array.prototype.push.apply(this.parent.children, removed);
      return child;
    };

    XMLNode.prototype.remove = function() {
      var i, ref1;
      if (this.isRoot) {
        throw new Error("Cannot remove the root element. " + this.debugInfo());
      }
      i = this.parent.children.indexOf(this);
      [].splice.apply(this.parent.children, [i, i - i + 1].concat(ref1 = [])), ref1;
      return this.parent;
    };

    XMLNode.prototype.node = function(name, attributes, text) {
      var child, ref1;
      if (name != null) {
        name = getValue(name);
      }
      attributes || (attributes = {});
      attributes = getValue(attributes);
      if (!isObject(attributes)) {
        ref1 = [attributes, text], text = ref1[0], attributes = ref1[1];
      }
      child = new XMLElement(this, name, attributes);
      if (text != null) {
        child.text(text);
      }
      this.children.push(child);
      return child;
    };

    XMLNode.prototype.text = function(value) {
      var child;
      child = new XMLText(this, value);
      this.children.push(child);
      return this;
    };

    XMLNode.prototype.cdata = function(value) {
      var child;
      child = new XMLCData(this, value);
      this.children.push(child);
      return this;
    };

    XMLNode.prototype.comment = function(value) {
      var child;
      child = new XMLComment(this, value);
      this.children.push(child);
      return this;
    };

    XMLNode.prototype.commentBefore = function(value) {
      var child, i, removed;
      i = this.parent.children.indexOf(this);
      removed = this.parent.children.splice(i);
      child = this.parent.comment(value);
      Array.prototype.push.apply(this.parent.children, removed);
      return this;
    };

    XMLNode.prototype.commentAfter = function(value) {
      var child, i, removed;
      i = this.parent.children.indexOf(this);
      removed = this.parent.children.splice(i + 1);
      child = this.parent.comment(value);
      Array.prototype.push.apply(this.parent.children, removed);
      return this;
    };

    XMLNode.prototype.raw = function(value) {
      var child;
      child = new XMLRaw(this, value);
      this.children.push(child);
      return this;
    };

    XMLNode.prototype.dummy = function() {
      var child;
      child = new XMLDummy(this);
      this.children.push(child);
      return child;
    };

    XMLNode.prototype.instruction = function(target, value) {
      var insTarget, insValue, instruction, j, len;
      if (target != null) {
        target = getValue(target);
      }
      if (value != null) {
        value = getValue(value);
      }
      if (Array.isArray(target)) {
        for (j = 0, len = target.length; j < len; j++) {
          insTarget = target[j];
          this.instruction(insTarget);
        }
      } else if (isObject(target)) {
        for (insTarget in target) {
          if (!hasProp.call(target, insTarget)) continue;
          insValue = target[insTarget];
          this.instruction(insTarget, insValue);
        }
      } else {
        if (isFunction(value)) {
          value = value.apply();
        }
        instruction = new XMLProcessingInstruction(this, target, value);
        this.children.push(instruction);
      }
      return this;
    };

    XMLNode.prototype.instructionBefore = function(target, value) {
      var child, i, removed;
      i = this.parent.children.indexOf(this);
      removed = this.parent.children.splice(i);
      child = this.parent.instruction(target, value);
      Array.prototype.push.apply(this.parent.children, removed);
      return this;
    };

    XMLNode.prototype.instructionAfter = function(target, value) {
      var child, i, removed;
      i = this.parent.children.indexOf(this);
      removed = this.parent.children.splice(i + 1);
      child = this.parent.instruction(target, value);
      Array.prototype.push.apply(this.parent.children, removed);
      return this;
    };

    XMLNode.prototype.declaration = function(version, encoding, standalone) {
      var doc, xmldec;
      doc = this.document();
      xmldec = new XMLDeclaration(doc, version, encoding, standalone);
      if (doc.children[0] instanceof XMLDeclaration) {
        doc.children[0] = xmldec;
      } else {
        doc.children.unshift(xmldec);
      }
      return doc.root() || doc;
    };

    XMLNode.prototype.doctype = function(pubID, sysID) {
      var child, doc, doctype, i, j, k, len, len1, ref1, ref2;
      doc = this.document();
      doctype = new XMLDocType(doc, pubID, sysID);
      ref1 = doc.children;
      for (i = j = 0, len = ref1.length; j < len; i = ++j) {
        child = ref1[i];
        if (child instanceof XMLDocType) {
          doc.children[i] = doctype;
          return doctype;
        }
      }
      ref2 = doc.children;
      for (i = k = 0, len1 = ref2.length; k < len1; i = ++k) {
        child = ref2[i];
        if (child.isRoot) {
          doc.children.splice(i, 0, doctype);
          return doctype;
        }
      }
      doc.children.push(doctype);
      return doctype;
    };

    XMLNode.prototype.up = function() {
      if (this.isRoot) {
        throw new Error("The root node has no parent. Use doc() if you need to get the document object.");
      }
      return this.parent;
    };

    XMLNode.prototype.root = function() {
      var node;
      node = this;
      while (node) {
        if (node.isDocument) {
          return node.rootObject;
        } else if (node.isRoot) {
          return node;
        } else {
          node = node.parent;
        }
      }
    };

    XMLNode.prototype.document = function() {
      var node;
      node = this;
      while (node) {
        if (node.isDocument) {
          return node;
        } else {
          node = node.parent;
        }
      }
    };

    XMLNode.prototype.end = function(options) {
      return this.document().end(options);
    };

    XMLNode.prototype.prev = function() {
      var i;
      i = this.parent.children.indexOf(this);
      while (i > 0 && this.parent.children[i - 1].isDummy) {
        i = i - 1;
      }
      if (i < 1) {
        throw new Error("Already at the first node. " + this.debugInfo());
      }
      return this.parent.children[i - 1];
    };

    XMLNode.prototype.next = function() {
      var i;
      i = this.parent.children.indexOf(this);
      while (i < this.parent.children.length - 1 && this.parent.children[i + 1].isDummy) {
        i = i + 1;
      }
      if (i === -1 || i === this.parent.children.length - 1) {
        throw new Error("Already at the last node. " + this.debugInfo());
      }
      return this.parent.children[i + 1];
    };

    XMLNode.prototype.importDocument = function(doc) {
      var clonedRoot;
      clonedRoot = doc.root().clone();
      clonedRoot.parent = this;
      clonedRoot.isRoot = false;
      this.children.push(clonedRoot);
      return this;
    };

    XMLNode.prototype.debugInfo = function(name) {
      var ref1, ref2;
      name = name || this.name;
      if ((name == null) && !((ref1 = this.parent) != null ? ref1.name : void 0)) {
        return "";
      } else if (name == null) {
        return "parent: <" + this.parent.name + ">";
      } else if (!((ref2 = this.parent) != null ? ref2.name : void 0)) {
        return "node: <" + name + ">";
      } else {
        return "node: <" + name + ">, parent: <" + this.parent.name + ">";
      }
    };

    XMLNode.prototype.ele = function(name, attributes, text) {
      return this.element(name, attributes, text);
    };

    XMLNode.prototype.nod = function(name, attributes, text) {
      return this.node(name, attributes, text);
    };

    XMLNode.prototype.txt = function(value) {
      return this.text(value);
    };

    XMLNode.prototype.dat = function(value) {
      return this.cdata(value);
    };

    XMLNode.prototype.com = function(value) {
      return this.comment(value);
    };

    XMLNode.prototype.ins = function(target, value) {
      return this.instruction(target, value);
    };

    XMLNode.prototype.doc = function() {
      return this.document();
    };

    XMLNode.prototype.dec = function(version, encoding, standalone) {
      return this.declaration(version, encoding, standalone);
    };

    XMLNode.prototype.dtd = function(pubID, sysID) {
      return this.doctype(pubID, sysID);
    };

    XMLNode.prototype.e = function(name, attributes, text) {
      return this.element(name, attributes, text);
    };

    XMLNode.prototype.n = function(name, attributes, text) {
      return this.node(name, attributes, text);
    };

    XMLNode.prototype.t = function(value) {
      return this.text(value);
    };

    XMLNode.prototype.d = function(value) {
      return this.cdata(value);
    };

    XMLNode.prototype.c = function(value) {
      return this.comment(value);
    };

    XMLNode.prototype.r = function(value) {
      return this.raw(value);
    };

    XMLNode.prototype.i = function(target, value) {
      return this.instruction(target, value);
    };

    XMLNode.prototype.u = function() {
      return this.up();
    };

    XMLNode.prototype.importXMLBuilder = function(doc) {
      return this.importDocument(doc);
    };

    return XMLNode;

  })();

}).call(this);


/***/ }),

/***/ 85915:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLNode, XMLProcessingInstruction,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLNode = __webpack_require__(10468);

  module.exports = XMLProcessingInstruction = (function(superClass) {
    extend(XMLProcessingInstruction, superClass);

    function XMLProcessingInstruction(parent, target, value) {
      XMLProcessingInstruction.__super__.constructor.call(this, parent);
      if (target == null) {
        throw new Error("Missing instruction target. " + this.debugInfo());
      }
      this.target = this.stringify.insTarget(target);
      if (value) {
        this.value = this.stringify.insValue(value);
      }
    }

    XMLProcessingInstruction.prototype.clone = function() {
      return Object.create(this);
    };

    XMLProcessingInstruction.prototype.toString = function(options) {
      return this.options.writer.set(options).processingInstruction(this);
    };

    return XMLProcessingInstruction;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 1268:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLNode, XMLRaw,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLNode = __webpack_require__(10468);

  module.exports = XMLRaw = (function(superClass) {
    extend(XMLRaw, superClass);

    function XMLRaw(parent, text) {
      XMLRaw.__super__.constructor.call(this, parent);
      if (text == null) {
        throw new Error("Missing raw text. " + this.debugInfo());
      }
      this.value = this.stringify.raw(text);
    }

    XMLRaw.prototype.clone = function() {
      return Object.create(this);
    };

    XMLRaw.prototype.toString = function(options) {
      return this.options.writer.set(options).raw(this);
    };

    return XMLRaw;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 96775:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLCData, XMLComment, XMLDTDAttList, XMLDTDElement, XMLDTDEntity, XMLDTDNotation, XMLDeclaration, XMLDocType, XMLDummy, XMLElement, XMLProcessingInstruction, XMLRaw, XMLStreamWriter, XMLText, XMLWriterBase,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLDeclaration = __webpack_require__(34130);

  XMLDocType = __webpack_require__(96376);

  XMLCData = __webpack_require__(92691);

  XMLComment = __webpack_require__(32679);

  XMLElement = __webpack_require__(33906);

  XMLRaw = __webpack_require__(1268);

  XMLText = __webpack_require__(82535);

  XMLProcessingInstruction = __webpack_require__(85915);

  XMLDummy = __webpack_require__(21218);

  XMLDTDAttList = __webpack_require__(34111);

  XMLDTDElement = __webpack_require__(67696);

  XMLDTDEntity = __webpack_require__(5529);

  XMLDTDNotation = __webpack_require__(28012);

  XMLWriterBase = __webpack_require__(6286);

  module.exports = XMLStreamWriter = (function(superClass) {
    extend(XMLStreamWriter, superClass);

    function XMLStreamWriter(stream, options) {
      XMLStreamWriter.__super__.constructor.call(this, options);
      this.stream = stream;
    }

    XMLStreamWriter.prototype.document = function(doc) {
      var child, i, j, len, len1, ref, ref1, results;
      ref = doc.children;
      for (i = 0, len = ref.length; i < len; i++) {
        child = ref[i];
        child.isLastRootNode = false;
      }
      doc.children[doc.children.length - 1].isLastRootNode = true;
      ref1 = doc.children;
      results = [];
      for (j = 0, len1 = ref1.length; j < len1; j++) {
        child = ref1[j];
        if (child instanceof XMLDummy) {
          continue;
        }
        switch (false) {
          case !(child instanceof XMLDeclaration):
            results.push(this.declaration(child));
            break;
          case !(child instanceof XMLDocType):
            results.push(this.docType(child));
            break;
          case !(child instanceof XMLComment):
            results.push(this.comment(child));
            break;
          case !(child instanceof XMLProcessingInstruction):
            results.push(this.processingInstruction(child));
            break;
          default:
            results.push(this.element(child));
        }
      }
      return results;
    };

    XMLStreamWriter.prototype.attribute = function(att) {
      return this.stream.write(' ' + att.name + '="' + att.value + '"');
    };

    XMLStreamWriter.prototype.cdata = function(node, level) {
      return this.stream.write(this.space(level) + '<![CDATA[' + node.text + ']]>' + this.endline(node));
    };

    XMLStreamWriter.prototype.comment = function(node, level) {
      return this.stream.write(this.space(level) + '<!-- ' + node.text + ' -->' + this.endline(node));
    };

    XMLStreamWriter.prototype.declaration = function(node, level) {
      this.stream.write(this.space(level));
      this.stream.write('<?xml version="' + node.version + '"');
      if (node.encoding != null) {
        this.stream.write(' encoding="' + node.encoding + '"');
      }
      if (node.standalone != null) {
        this.stream.write(' standalone="' + node.standalone + '"');
      }
      this.stream.write(this.spacebeforeslash + '?>');
      return this.stream.write(this.endline(node));
    };

    XMLStreamWriter.prototype.docType = function(node, level) {
      var child, i, len, ref;
      level || (level = 0);
      this.stream.write(this.space(level));
      this.stream.write('<!DOCTYPE ' + node.root().name);
      if (node.pubID && node.sysID) {
        this.stream.write(' PUBLIC "' + node.pubID + '" "' + node.sysID + '"');
      } else if (node.sysID) {
        this.stream.write(' SYSTEM "' + node.sysID + '"');
      }
      if (node.children.length > 0) {
        this.stream.write(' [');
        this.stream.write(this.endline(node));
        ref = node.children;
        for (i = 0, len = ref.length; i < len; i++) {
          child = ref[i];
          switch (false) {
            case !(child instanceof XMLDTDAttList):
              this.dtdAttList(child, level + 1);
              break;
            case !(child instanceof XMLDTDElement):
              this.dtdElement(child, level + 1);
              break;
            case !(child instanceof XMLDTDEntity):
              this.dtdEntity(child, level + 1);
              break;
            case !(child instanceof XMLDTDNotation):
              this.dtdNotation(child, level + 1);
              break;
            case !(child instanceof XMLCData):
              this.cdata(child, level + 1);
              break;
            case !(child instanceof XMLComment):
              this.comment(child, level + 1);
              break;
            case !(child instanceof XMLProcessingInstruction):
              this.processingInstruction(child, level + 1);
              break;
            default:
              throw new Error("Unknown DTD node type: " + child.constructor.name);
          }
        }
        this.stream.write(']');
      }
      this.stream.write(this.spacebeforeslash + '>');
      return this.stream.write(this.endline(node));
    };

    XMLStreamWriter.prototype.element = function(node, level) {
      var att, child, i, len, name, ref, ref1, space;
      level || (level = 0);
      space = this.space(level);
      this.stream.write(space + '<' + node.name);
      ref = node.attributes;
      for (name in ref) {
        if (!hasProp.call(ref, name)) continue;
        att = ref[name];
        this.attribute(att);
      }
      if (node.children.length === 0 || node.children.every(function(e) {
        return e.value === '';
      })) {
        if (this.allowEmpty) {
          this.stream.write('></' + node.name + '>');
        } else {
          this.stream.write(this.spacebeforeslash + '/>');
        }
      } else if (this.pretty && node.children.length === 1 && (node.children[0].value != null)) {
        this.stream.write('>');
        this.stream.write(node.children[0].value);
        this.stream.write('</' + node.name + '>');
      } else {
        this.stream.write('>' + this.newline);
        ref1 = node.children;
        for (i = 0, len = ref1.length; i < len; i++) {
          child = ref1[i];
          switch (false) {
            case !(child instanceof XMLCData):
              this.cdata(child, level + 1);
              break;
            case !(child instanceof XMLComment):
              this.comment(child, level + 1);
              break;
            case !(child instanceof XMLElement):
              this.element(child, level + 1);
              break;
            case !(child instanceof XMLRaw):
              this.raw(child, level + 1);
              break;
            case !(child instanceof XMLText):
              this.text(child, level + 1);
              break;
            case !(child instanceof XMLProcessingInstruction):
              this.processingInstruction(child, level + 1);
              break;
            case !(child instanceof XMLDummy):
              '';
              break;
            default:
              throw new Error("Unknown XML node type: " + child.constructor.name);
          }
        }
        this.stream.write(space + '</' + node.name + '>');
      }
      return this.stream.write(this.endline(node));
    };

    XMLStreamWriter.prototype.processingInstruction = function(node, level) {
      this.stream.write(this.space(level) + '<?' + node.target);
      if (node.value) {
        this.stream.write(' ' + node.value);
      }
      return this.stream.write(this.spacebeforeslash + '?>' + this.endline(node));
    };

    XMLStreamWriter.prototype.raw = function(node, level) {
      return this.stream.write(this.space(level) + node.value + this.endline(node));
    };

    XMLStreamWriter.prototype.text = function(node, level) {
      return this.stream.write(this.space(level) + node.value + this.endline(node));
    };

    XMLStreamWriter.prototype.dtdAttList = function(node, level) {
      this.stream.write(this.space(level) + '<!ATTLIST ' + node.elementName + ' ' + node.attributeName + ' ' + node.attributeType);
      if (node.defaultValueType !== '#DEFAULT') {
        this.stream.write(' ' + node.defaultValueType);
      }
      if (node.defaultValue) {
        this.stream.write(' "' + node.defaultValue + '"');
      }
      return this.stream.write(this.spacebeforeslash + '>' + this.endline(node));
    };

    XMLStreamWriter.prototype.dtdElement = function(node, level) {
      this.stream.write(this.space(level) + '<!ELEMENT ' + node.name + ' ' + node.value);
      return this.stream.write(this.spacebeforeslash + '>' + this.endline(node));
    };

    XMLStreamWriter.prototype.dtdEntity = function(node, level) {
      this.stream.write(this.space(level) + '<!ENTITY');
      if (node.pe) {
        this.stream.write(' %');
      }
      this.stream.write(' ' + node.name);
      if (node.value) {
        this.stream.write(' "' + node.value + '"');
      } else {
        if (node.pubID && node.sysID) {
          this.stream.write(' PUBLIC "' + node.pubID + '" "' + node.sysID + '"');
        } else if (node.sysID) {
          this.stream.write(' SYSTEM "' + node.sysID + '"');
        }
        if (node.nData) {
          this.stream.write(' NDATA ' + node.nData);
        }
      }
      return this.stream.write(this.spacebeforeslash + '>' + this.endline(node));
    };

    XMLStreamWriter.prototype.dtdNotation = function(node, level) {
      this.stream.write(this.space(level) + '<!NOTATION ' + node.name);
      if (node.pubID && node.sysID) {
        this.stream.write(' PUBLIC "' + node.pubID + '" "' + node.sysID + '"');
      } else if (node.pubID) {
        this.stream.write(' PUBLIC "' + node.pubID + '"');
      } else if (node.sysID) {
        this.stream.write(' SYSTEM "' + node.sysID + '"');
      }
      return this.stream.write(this.spacebeforeslash + '>' + this.endline(node));
    };

    XMLStreamWriter.prototype.endline = function(node) {
      if (!node.isLastRootNode) {
        return this.newline;
      } else {
        return '';
      }
    };

    return XMLStreamWriter;

  })(XMLWriterBase);

}).call(this);


/***/ }),

/***/ 40382:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLCData, XMLComment, XMLDTDAttList, XMLDTDElement, XMLDTDEntity, XMLDTDNotation, XMLDeclaration, XMLDocType, XMLDummy, XMLElement, XMLProcessingInstruction, XMLRaw, XMLStringWriter, XMLText, XMLWriterBase,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLDeclaration = __webpack_require__(34130);

  XMLDocType = __webpack_require__(96376);

  XMLCData = __webpack_require__(92691);

  XMLComment = __webpack_require__(32679);

  XMLElement = __webpack_require__(33906);

  XMLRaw = __webpack_require__(1268);

  XMLText = __webpack_require__(82535);

  XMLProcessingInstruction = __webpack_require__(85915);

  XMLDummy = __webpack_require__(21218);

  XMLDTDAttList = __webpack_require__(34111);

  XMLDTDElement = __webpack_require__(67696);

  XMLDTDEntity = __webpack_require__(5529);

  XMLDTDNotation = __webpack_require__(28012);

  XMLWriterBase = __webpack_require__(6286);

  module.exports = XMLStringWriter = (function(superClass) {
    extend(XMLStringWriter, superClass);

    function XMLStringWriter(options) {
      XMLStringWriter.__super__.constructor.call(this, options);
    }

    XMLStringWriter.prototype.document = function(doc) {
      var child, i, len, r, ref;
      this.textispresent = false;
      r = '';
      ref = doc.children;
      for (i = 0, len = ref.length; i < len; i++) {
        child = ref[i];
        if (child instanceof XMLDummy) {
          continue;
        }
        r += (function() {
          switch (false) {
            case !(child instanceof XMLDeclaration):
              return this.declaration(child);
            case !(child instanceof XMLDocType):
              return this.docType(child);
            case !(child instanceof XMLComment):
              return this.comment(child);
            case !(child instanceof XMLProcessingInstruction):
              return this.processingInstruction(child);
            default:
              return this.element(child, 0);
          }
        }).call(this);
      }
      if (this.pretty && r.slice(-this.newline.length) === this.newline) {
        r = r.slice(0, -this.newline.length);
      }
      return r;
    };

    XMLStringWriter.prototype.attribute = function(att) {
      return ' ' + att.name + '="' + att.value + '"';
    };

    XMLStringWriter.prototype.cdata = function(node, level) {
      return this.space(level) + '<![CDATA[' + node.text + ']]>' + this.newline;
    };

    XMLStringWriter.prototype.comment = function(node, level) {
      return this.space(level) + '<!-- ' + node.text + ' -->' + this.newline;
    };

    XMLStringWriter.prototype.declaration = function(node, level) {
      var r;
      r = this.space(level);
      r += '<?xml version="' + node.version + '"';
      if (node.encoding != null) {
        r += ' encoding="' + node.encoding + '"';
      }
      if (node.standalone != null) {
        r += ' standalone="' + node.standalone + '"';
      }
      r += this.spacebeforeslash + '?>';
      r += this.newline;
      return r;
    };

    XMLStringWriter.prototype.docType = function(node, level) {
      var child, i, len, r, ref;
      level || (level = 0);
      r = this.space(level);
      r += '<!DOCTYPE ' + node.root().name;
      if (node.pubID && node.sysID) {
        r += ' PUBLIC "' + node.pubID + '" "' + node.sysID + '"';
      } else if (node.sysID) {
        r += ' SYSTEM "' + node.sysID + '"';
      }
      if (node.children.length > 0) {
        r += ' [';
        r += this.newline;
        ref = node.children;
        for (i = 0, len = ref.length; i < len; i++) {
          child = ref[i];
          r += (function() {
            switch (false) {
              case !(child instanceof XMLDTDAttList):
                return this.dtdAttList(child, level + 1);
              case !(child instanceof XMLDTDElement):
                return this.dtdElement(child, level + 1);
              case !(child instanceof XMLDTDEntity):
                return this.dtdEntity(child, level + 1);
              case !(child instanceof XMLDTDNotation):
                return this.dtdNotation(child, level + 1);
              case !(child instanceof XMLCData):
                return this.cdata(child, level + 1);
              case !(child instanceof XMLComment):
                return this.comment(child, level + 1);
              case !(child instanceof XMLProcessingInstruction):
                return this.processingInstruction(child, level + 1);
              default:
                throw new Error("Unknown DTD node type: " + child.constructor.name);
            }
          }).call(this);
        }
        r += ']';
      }
      r += this.spacebeforeslash + '>';
      r += this.newline;
      return r;
    };

    XMLStringWriter.prototype.element = function(node, level) {
      var att, child, i, j, len, len1, name, r, ref, ref1, ref2, space, textispresentwasset;
      level || (level = 0);
      textispresentwasset = false;
      if (this.textispresent) {
        this.newline = '';
        this.pretty = false;
      } else {
        this.newline = this.newlinedefault;
        this.pretty = this.prettydefault;
      }
      space = this.space(level);
      r = '';
      r += space + '<' + node.name;
      ref = node.attributes;
      for (name in ref) {
        if (!hasProp.call(ref, name)) continue;
        att = ref[name];
        r += this.attribute(att);
      }
      if (node.children.length === 0 || node.children.every(function(e) {
        return e.value === '';
      })) {
        if (this.allowEmpty) {
          r += '></' + node.name + '>' + this.newline;
        } else {
          r += this.spacebeforeslash + '/>' + this.newline;
        }
      } else if (this.pretty && node.children.length === 1 && (node.children[0].value != null)) {
        r += '>';
        r += node.children[0].value;
        r += '</' + node.name + '>' + this.newline;
      } else {
        if (this.dontprettytextnodes) {
          ref1 = node.children;
          for (i = 0, len = ref1.length; i < len; i++) {
            child = ref1[i];
            if (child.value != null) {
              this.textispresent++;
              textispresentwasset = true;
              break;
            }
          }
        }
        if (this.textispresent) {
          this.newline = '';
          this.pretty = false;
          space = this.space(level);
        }
        r += '>' + this.newline;
        ref2 = node.children;
        for (j = 0, len1 = ref2.length; j < len1; j++) {
          child = ref2[j];
          r += (function() {
            switch (false) {
              case !(child instanceof XMLCData):
                return this.cdata(child, level + 1);
              case !(child instanceof XMLComment):
                return this.comment(child, level + 1);
              case !(child instanceof XMLElement):
                return this.element(child, level + 1);
              case !(child instanceof XMLRaw):
                return this.raw(child, level + 1);
              case !(child instanceof XMLText):
                return this.text(child, level + 1);
              case !(child instanceof XMLProcessingInstruction):
                return this.processingInstruction(child, level + 1);
              case !(child instanceof XMLDummy):
                return '';
              default:
                throw new Error("Unknown XML node type: " + child.constructor.name);
            }
          }).call(this);
        }
        if (textispresentwasset) {
          this.textispresent--;
        }
        if (!this.textispresent) {
          this.newline = this.newlinedefault;
          this.pretty = this.prettydefault;
        }
        r += space + '</' + node.name + '>' + this.newline;
      }
      return r;
    };

    XMLStringWriter.prototype.processingInstruction = function(node, level) {
      var r;
      r = this.space(level) + '<?' + node.target;
      if (node.value) {
        r += ' ' + node.value;
      }
      r += this.spacebeforeslash + '?>' + this.newline;
      return r;
    };

    XMLStringWriter.prototype.raw = function(node, level) {
      return this.space(level) + node.value + this.newline;
    };

    XMLStringWriter.prototype.text = function(node, level) {
      return this.space(level) + node.value + this.newline;
    };

    XMLStringWriter.prototype.dtdAttList = function(node, level) {
      var r;
      r = this.space(level) + '<!ATTLIST ' + node.elementName + ' ' + node.attributeName + ' ' + node.attributeType;
      if (node.defaultValueType !== '#DEFAULT') {
        r += ' ' + node.defaultValueType;
      }
      if (node.defaultValue) {
        r += ' "' + node.defaultValue + '"';
      }
      r += this.spacebeforeslash + '>' + this.newline;
      return r;
    };

    XMLStringWriter.prototype.dtdElement = function(node, level) {
      return this.space(level) + '<!ELEMENT ' + node.name + ' ' + node.value + this.spacebeforeslash + '>' + this.newline;
    };

    XMLStringWriter.prototype.dtdEntity = function(node, level) {
      var r;
      r = this.space(level) + '<!ENTITY';
      if (node.pe) {
        r += ' %';
      }
      r += ' ' + node.name;
      if (node.value) {
        r += ' "' + node.value + '"';
      } else {
        if (node.pubID && node.sysID) {
          r += ' PUBLIC "' + node.pubID + '" "' + node.sysID + '"';
        } else if (node.sysID) {
          r += ' SYSTEM "' + node.sysID + '"';
        }
        if (node.nData) {
          r += ' NDATA ' + node.nData;
        }
      }
      r += this.spacebeforeslash + '>' + this.newline;
      return r;
    };

    XMLStringWriter.prototype.dtdNotation = function(node, level) {
      var r;
      r = this.space(level) + '<!NOTATION ' + node.name;
      if (node.pubID && node.sysID) {
        r += ' PUBLIC "' + node.pubID + '" "' + node.sysID + '"';
      } else if (node.pubID) {
        r += ' PUBLIC "' + node.pubID + '"';
      } else if (node.sysID) {
        r += ' SYSTEM "' + node.sysID + '"';
      }
      r += this.spacebeforeslash + '>' + this.newline;
      return r;
    };

    XMLStringWriter.prototype.openNode = function(node, level) {
      var att, name, r, ref;
      level || (level = 0);
      if (node instanceof XMLElement) {
        r = this.space(level) + '<' + node.name;
        ref = node.attributes;
        for (name in ref) {
          if (!hasProp.call(ref, name)) continue;
          att = ref[name];
          r += this.attribute(att);
        }
        r += (node.children ? '>' : '/>') + this.newline;
        return r;
      } else {
        r = this.space(level) + '<!DOCTYPE ' + node.rootNodeName;
        if (node.pubID && node.sysID) {
          r += ' PUBLIC "' + node.pubID + '" "' + node.sysID + '"';
        } else if (node.sysID) {
          r += ' SYSTEM "' + node.sysID + '"';
        }
        r += (node.children ? ' [' : '>') + this.newline;
        return r;
      }
    };

    XMLStringWriter.prototype.closeNode = function(node, level) {
      level || (level = 0);
      switch (false) {
        case !(node instanceof XMLElement):
          return this.space(level) + '</' + node.name + '>' + this.newline;
        case !(node instanceof XMLDocType):
          return this.space(level) + ']>' + this.newline;
      }
    };

    return XMLStringWriter;

  })(XMLWriterBase);

}).call(this);


/***/ }),

/***/ 43976:
/***/ (function(module) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLStringifier,
    bind = function(fn, me){ return function(){ return fn.apply(me, arguments); }; },
    hasProp = {}.hasOwnProperty;

  module.exports = XMLStringifier = (function() {
    function XMLStringifier(options) {
      this.assertLegalChar = bind(this.assertLegalChar, this);
      var key, ref, value;
      options || (options = {});
      this.noDoubleEncoding = options.noDoubleEncoding;
      ref = options.stringify || {};
      for (key in ref) {
        if (!hasProp.call(ref, key)) continue;
        value = ref[key];
        this[key] = value;
      }
    }

    XMLStringifier.prototype.eleName = function(val) {
      val = '' + val || '';
      return this.assertLegalChar(val);
    };

    XMLStringifier.prototype.eleText = function(val) {
      val = '' + val || '';
      return this.assertLegalChar(this.elEscape(val));
    };

    XMLStringifier.prototype.cdata = function(val) {
      val = '' + val || '';
      val = val.replace(']]>', ']]]]><![CDATA[>');
      return this.assertLegalChar(val);
    };

    XMLStringifier.prototype.comment = function(val) {
      val = '' + val || '';
      if (val.match(/--/)) {
        throw new Error("Comment text cannot contain double-hypen: " + val);
      }
      return this.assertLegalChar(val);
    };

    XMLStringifier.prototype.raw = function(val) {
      return '' + val || '';
    };

    XMLStringifier.prototype.attName = function(val) {
      return val = '' + val || '';
    };

    XMLStringifier.prototype.attValue = function(val) {
      val = '' + val || '';
      return this.attEscape(val);
    };

    XMLStringifier.prototype.insTarget = function(val) {
      return '' + val || '';
    };

    XMLStringifier.prototype.insValue = function(val) {
      val = '' + val || '';
      if (val.match(/\?>/)) {
        throw new Error("Invalid processing instruction value: " + val);
      }
      return val;
    };

    XMLStringifier.prototype.xmlVersion = function(val) {
      val = '' + val || '';
      if (!val.match(/1\.[0-9]+/)) {
        throw new Error("Invalid version number: " + val);
      }
      return val;
    };

    XMLStringifier.prototype.xmlEncoding = function(val) {
      val = '' + val || '';
      if (!val.match(/^[A-Za-z](?:[A-Za-z0-9._-])*$/)) {
        throw new Error("Invalid encoding: " + val);
      }
      return val;
    };

    XMLStringifier.prototype.xmlStandalone = function(val) {
      if (val) {
        return "yes";
      } else {
        return "no";
      }
    };

    XMLStringifier.prototype.dtdPubID = function(val) {
      return '' + val || '';
    };

    XMLStringifier.prototype.dtdSysID = function(val) {
      return '' + val || '';
    };

    XMLStringifier.prototype.dtdElementValue = function(val) {
      return '' + val || '';
    };

    XMLStringifier.prototype.dtdAttType = function(val) {
      return '' + val || '';
    };

    XMLStringifier.prototype.dtdAttDefault = function(val) {
      if (val != null) {
        return '' + val || '';
      } else {
        return val;
      }
    };

    XMLStringifier.prototype.dtdEntityValue = function(val) {
      return '' + val || '';
    };

    XMLStringifier.prototype.dtdNData = function(val) {
      return '' + val || '';
    };

    XMLStringifier.prototype.convertAttKey = '@';

    XMLStringifier.prototype.convertPIKey = '?';

    XMLStringifier.prototype.convertTextKey = '#text';

    XMLStringifier.prototype.convertCDataKey = '#cdata';

    XMLStringifier.prototype.convertCommentKey = '#comment';

    XMLStringifier.prototype.convertRawKey = '#raw';

    XMLStringifier.prototype.assertLegalChar = function(str) {
      var res;
      res = str.match(/[\0\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/);
      if (res) {
        throw new Error("Invalid character in string: " + str + " at index " + res.index);
      }
      return str;
    };

    XMLStringifier.prototype.elEscape = function(str) {
      var ampregex;
      ampregex = this.noDoubleEncoding ? /(?!&\S+;)&/g : /&/g;
      return str.replace(ampregex, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\r/g, '&#xD;');
    };

    XMLStringifier.prototype.attEscape = function(str) {
      var ampregex;
      ampregex = this.noDoubleEncoding ? /(?!&\S+;)&/g : /&/g;
      return str.replace(ampregex, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/\t/g, '&#x9;').replace(/\n/g, '&#xA;').replace(/\r/g, '&#xD;');
    };

    return XMLStringifier;

  })();

}).call(this);


/***/ }),

/***/ 82535:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLNode, XMLText,
    extend = function(child, parent) { for (var key in parent) { if (hasProp.call(parent, key)) child[key] = parent[key]; } function ctor() { this.constructor = child; } ctor.prototype = parent.prototype; child.prototype = new ctor(); child.__super__ = parent.prototype; return child; },
    hasProp = {}.hasOwnProperty;

  XMLNode = __webpack_require__(10468);

  module.exports = XMLText = (function(superClass) {
    extend(XMLText, superClass);

    function XMLText(parent, text) {
      XMLText.__super__.constructor.call(this, parent);
      if (text == null) {
        throw new Error("Missing element text. " + this.debugInfo());
      }
      this.value = this.stringify.eleText(text);
    }

    XMLText.prototype.clone = function() {
      return Object.create(this);
    };

    XMLText.prototype.toString = function(options) {
      return this.options.writer.set(options).text(this);
    };

    return XMLText;

  })(XMLNode);

}).call(this);


/***/ }),

/***/ 6286:
/***/ (function(module) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLWriterBase,
    hasProp = {}.hasOwnProperty;

  module.exports = XMLWriterBase = (function() {
    function XMLWriterBase(options) {
      var key, ref, ref1, ref2, ref3, ref4, ref5, ref6, value;
      options || (options = {});
      this.pretty = options.pretty || false;
      this.allowEmpty = (ref = options.allowEmpty) != null ? ref : false;
      if (this.pretty) {
        this.indent = (ref1 = options.indent) != null ? ref1 : '  ';
        this.newline = (ref2 = options.newline) != null ? ref2 : '\n';
        this.offset = (ref3 = options.offset) != null ? ref3 : 0;
        this.dontprettytextnodes = (ref4 = options.dontprettytextnodes) != null ? ref4 : 0;
      } else {
        this.indent = '';
        this.newline = '';
        this.offset = 0;
        this.dontprettytextnodes = 0;
      }
      this.spacebeforeslash = (ref5 = options.spacebeforeslash) != null ? ref5 : '';
      if (this.spacebeforeslash === true) {
        this.spacebeforeslash = ' ';
      }
      this.newlinedefault = this.newline;
      this.prettydefault = this.pretty;
      ref6 = options.writer || {};
      for (key in ref6) {
        if (!hasProp.call(ref6, key)) continue;
        value = ref6[key];
        this[key] = value;
      }
    }

    XMLWriterBase.prototype.set = function(options) {
      var key, ref, value;
      options || (options = {});
      if ("pretty" in options) {
        this.pretty = options.pretty;
      }
      if ("allowEmpty" in options) {
        this.allowEmpty = options.allowEmpty;
      }
      if (this.pretty) {
        this.indent = "indent" in options ? options.indent : '  ';
        this.newline = "newline" in options ? options.newline : '\n';
        this.offset = "offset" in options ? options.offset : 0;
        this.dontprettytextnodes = "dontprettytextnodes" in options ? options.dontprettytextnodes : 0;
      } else {
        this.indent = '';
        this.newline = '';
        this.offset = 0;
        this.dontprettytextnodes = 0;
      }
      this.spacebeforeslash = "spacebeforeslash" in options ? options.spacebeforeslash : '';
      if (this.spacebeforeslash === true) {
        this.spacebeforeslash = ' ';
      }
      this.newlinedefault = this.newline;
      this.prettydefault = this.pretty;
      ref = options.writer || {};
      for (key in ref) {
        if (!hasProp.call(ref, key)) continue;
        value = ref[key];
        this[key] = value;
      }
      return this;
    };

    XMLWriterBase.prototype.space = function(level) {
      var indent;
      if (this.pretty) {
        indent = (level || 0) + this.offset + 1;
        if (indent > 0) {
          return new Array(indent).join(this.indent);
        } else {
          return '';
        }
      } else {
        return '';
      }
    };

    return XMLWriterBase;

  })();

}).call(this);


/***/ }),

/***/ 59665:
/***/ (function(module, __unused_webpack_exports, __webpack_require__) {

// Generated by CoffeeScript 1.12.7
(function() {
  var XMLDocument, XMLDocumentCB, XMLStreamWriter, XMLStringWriter, assign, isFunction, ref;

  ref = __webpack_require__(49241), assign = ref.assign, isFunction = ref.isFunction;

  XMLDocument = __webpack_require__(71933);

  XMLDocumentCB = __webpack_require__(80400);

  XMLStringWriter = __webpack_require__(40382);

  XMLStreamWriter = __webpack_require__(96775);

  module.exports.create = function(name, xmldec, doctype, options) {
    var doc, root;
    if (name == null) {
      throw new Error("Root element needs a name.");
    }
    options = assign({}, xmldec, doctype, options);
    doc = new XMLDocument(options);
    root = doc.element(name);
    if (!options.headless) {
      doc.declaration(options);
      if ((options.pubID != null) || (options.sysID != null)) {
        doc.doctype(options);
      }
    }
    return root;
  };

  module.exports.begin = function(options, onData, onEnd) {
    var ref1;
    if (isFunction(options)) {
      ref1 = [options, onData], onData = ref1[0], onEnd = ref1[1];
      options = {};
    }
    if (onData) {
      return new XMLDocumentCB(options, onData, onEnd);
    } else {
      return new XMLDocument(options);
    }
  };

  module.exports.stringWriter = function(options) {
    return new XMLStringWriter(options);
  };

  module.exports.streamWriter = function(stream, options) {
    return new XMLStreamWriter(stream, options);
  };

}).call(this);


/***/ }),

/***/ 4523:
/***/ (function(__unused_webpack___webpack_module__, __webpack_exports__, __webpack_require__) {

"use strict";
// ESM COMPAT FLAG
__webpack_require__.r(__webpack_exports__);

// EXPORTS
__webpack_require__.d(__webpack_exports__, {
  VERSION: function() { return /* reexport */ VERSION; },
  after: function() { return /* reexport */ after; },
  all: function() { return /* reexport */ every; },
  allKeys: function() { return /* reexport */ allKeys; },
  any: function() { return /* reexport */ some; },
  assign: function() { return /* reexport */ extendOwn; },
  before: function() { return /* reexport */ before; },
  bind: function() { return /* reexport */ bind; },
  bindAll: function() { return /* reexport */ bindAll; },
  chain: function() { return /* reexport */ chain; },
  chunk: function() { return /* reexport */ chunk; },
  clone: function() { return /* reexport */ clone; },
  collect: function() { return /* reexport */ map; },
  compact: function() { return /* reexport */ compact; },
  compose: function() { return /* reexport */ compose; },
  constant: function() { return /* reexport */ constant; },
  contains: function() { return /* reexport */ contains; },
  countBy: function() { return /* reexport */ countBy; },
  create: function() { return /* reexport */ create; },
  debounce: function() { return /* reexport */ debounce; },
  "default": function() { return /* reexport */ index_default; },
  defaults: function() { return /* reexport */ defaults; },
  defer: function() { return /* reexport */ defer; },
  delay: function() { return /* reexport */ delay; },
  detect: function() { return /* reexport */ find; },
  difference: function() { return /* reexport */ difference; },
  drop: function() { return /* reexport */ rest; },
  each: function() { return /* reexport */ each; },
  escape: function() { return /* reexport */ modules_escape; },
  every: function() { return /* reexport */ every; },
  extend: function() { return /* reexport */ extend; },
  extendOwn: function() { return /* reexport */ extendOwn; },
  filter: function() { return /* reexport */ filter; },
  find: function() { return /* reexport */ find; },
  findIndex: function() { return /* reexport */ findIndex; },
  findKey: function() { return /* reexport */ findKey; },
  findLastIndex: function() { return /* reexport */ findLastIndex; },
  findWhere: function() { return /* reexport */ findWhere; },
  first: function() { return /* reexport */ first; },
  flatten: function() { return /* reexport */ flatten_flatten; },
  foldl: function() { return /* reexport */ reduce; },
  foldr: function() { return /* reexport */ reduceRight; },
  forEach: function() { return /* reexport */ each; },
  functions: function() { return /* reexport */ functions; },
  get: function() { return /* reexport */ get; },
  groupBy: function() { return /* reexport */ groupBy; },
  has: function() { return /* reexport */ has_has; },
  head: function() { return /* reexport */ first; },
  identity: function() { return /* reexport */ identity; },
  include: function() { return /* reexport */ contains; },
  includes: function() { return /* reexport */ contains; },
  indexBy: function() { return /* reexport */ indexBy; },
  indexOf: function() { return /* reexport */ indexOf; },
  initial: function() { return /* reexport */ initial; },
  inject: function() { return /* reexport */ reduce; },
  intersection: function() { return /* reexport */ intersection; },
  invert: function() { return /* reexport */ invert; },
  invoke: function() { return /* reexport */ invoke; },
  isArguments: function() { return /* reexport */ modules_isArguments; },
  isArray: function() { return /* reexport */ isArray; },
  isArrayBuffer: function() { return /* reexport */ isArrayBuffer; },
  isBoolean: function() { return /* reexport */ isBoolean; },
  isDataView: function() { return /* reexport */ modules_isDataView; },
  isDate: function() { return /* reexport */ isDate; },
  isElement: function() { return /* reexport */ isElement; },
  isEmpty: function() { return /* reexport */ isEmpty; },
  isEqual: function() { return /* reexport */ isEqual; },
  isError: function() { return /* reexport */ isError; },
  isFinite: function() { return /* reexport */ isFinite_isFinite; },
  isFunction: function() { return /* reexport */ modules_isFunction; },
  isMap: function() { return /* reexport */ isMap; },
  isMatch: function() { return /* reexport */ isMatch; },
  isNaN: function() { return /* reexport */ isNaN_isNaN; },
  isNull: function() { return /* reexport */ isNull; },
  isNumber: function() { return /* reexport */ isNumber; },
  isObject: function() { return /* reexport */ isObject; },
  isRegExp: function() { return /* reexport */ isRegExp; },
  isSet: function() { return /* reexport */ isSet; },
  isString: function() { return /* reexport */ isString; },
  isSymbol: function() { return /* reexport */ isSymbol; },
  isTypedArray: function() { return /* reexport */ modules_isTypedArray; },
  isUndefined: function() { return /* reexport */ isUndefined; },
  isWeakMap: function() { return /* reexport */ isWeakMap; },
  isWeakSet: function() { return /* reexport */ isWeakSet; },
  iteratee: function() { return /* reexport */ iteratee; },
  keys: function() { return /* reexport */ keys; },
  last: function() { return /* reexport */ last; },
  lastIndexOf: function() { return /* reexport */ lastIndexOf; },
  map: function() { return /* reexport */ map; },
  mapObject: function() { return /* reexport */ mapObject; },
  matcher: function() { return /* reexport */ matcher; },
  matches: function() { return /* reexport */ matcher; },
  max: function() { return /* reexport */ max; },
  memoize: function() { return /* reexport */ memoize; },
  methods: function() { return /* reexport */ functions; },
  min: function() { return /* reexport */ min; },
  mixin: function() { return /* reexport */ mixin; },
  negate: function() { return /* reexport */ negate; },
  noop: function() { return /* reexport */ noop; },
  now: function() { return /* reexport */ now; },
  object: function() { return /* reexport */ object; },
  omit: function() { return /* reexport */ omit; },
  once: function() { return /* reexport */ once; },
  pairs: function() { return /* reexport */ pairs; },
  partial: function() { return /* reexport */ modules_partial; },
  partition: function() { return /* reexport */ partition; },
  pick: function() { return /* reexport */ pick; },
  pluck: function() { return /* reexport */ pluck; },
  property: function() { return /* reexport */ property; },
  propertyOf: function() { return /* reexport */ propertyOf; },
  random: function() { return /* reexport */ random; },
  range: function() { return /* reexport */ range; },
  reduce: function() { return /* reexport */ reduce; },
  reduceRight: function() { return /* reexport */ reduceRight; },
  reject: function() { return /* reexport */ reject; },
  rest: function() { return /* reexport */ rest; },
  restArguments: function() { return /* reexport */ restArguments; },
  result: function() { return /* reexport */ result; },
  sample: function() { return /* reexport */ sample; },
  select: function() { return /* reexport */ filter; },
  shuffle: function() { return /* reexport */ shuffle; },
  size: function() { return /* reexport */ size; },
  some: function() { return /* reexport */ some; },
  sortBy: function() { return /* reexport */ sortBy; },
  sortedIndex: function() { return /* reexport */ sortedIndex; },
  tail: function() { return /* reexport */ rest; },
  take: function() { return /* reexport */ first; },
  tap: function() { return /* reexport */ tap; },
  template: function() { return /* reexport */ template; },
  templateSettings: function() { return /* reexport */ templateSettings; },
  throttle: function() { return /* reexport */ throttle; },
  times: function() { return /* reexport */ times; },
  toArray: function() { return /* reexport */ toArray; },
  toPath: function() { return /* reexport */ toPath; },
  transpose: function() { return /* reexport */ unzip; },
  unescape: function() { return /* reexport */ modules_unescape; },
  union: function() { return /* reexport */ union; },
  uniq: function() { return /* reexport */ uniq; },
  unique: function() { return /* reexport */ uniq; },
  uniqueId: function() { return /* reexport */ uniqueId; },
  unzip: function() { return /* reexport */ unzip; },
  values: function() { return /* reexport */ values; },
  where: function() { return /* reexport */ where; },
  without: function() { return /* reexport */ without; },
  wrap: function() { return /* reexport */ wrap; },
  zip: function() { return /* reexport */ zip; }
});

// NAMESPACE OBJECT: ./node_modules/underscore/modules/index.js
var modules_namespaceObject = {};
__webpack_require__.r(modules_namespaceObject);
__webpack_require__.d(modules_namespaceObject, {
  VERSION: function() { return VERSION; },
  after: function() { return after; },
  all: function() { return every; },
  allKeys: function() { return allKeys; },
  any: function() { return some; },
  assign: function() { return extendOwn; },
  before: function() { return before; },
  bind: function() { return bind; },
  bindAll: function() { return bindAll; },
  chain: function() { return chain; },
  chunk: function() { return chunk; },
  clone: function() { return clone; },
  collect: function() { return map; },
  compact: function() { return compact; },
  compose: function() { return compose; },
  constant: function() { return constant; },
  contains: function() { return contains; },
  countBy: function() { return countBy; },
  create: function() { return create; },
  debounce: function() { return debounce; },
  "default": function() { return underscore_array_methods; },
  defaults: function() { return defaults; },
  defer: function() { return defer; },
  delay: function() { return delay; },
  detect: function() { return find; },
  difference: function() { return difference; },
  drop: function() { return rest; },
  each: function() { return each; },
  escape: function() { return modules_escape; },
  every: function() { return every; },
  extend: function() { return extend; },
  extendOwn: function() { return extendOwn; },
  filter: function() { return filter; },
  find: function() { return find; },
  findIndex: function() { return findIndex; },
  findKey: function() { return findKey; },
  findLastIndex: function() { return findLastIndex; },
  findWhere: function() { return findWhere; },
  first: function() { return first; },
  flatten: function() { return flatten_flatten; },
  foldl: function() { return reduce; },
  foldr: function() { return reduceRight; },
  forEach: function() { return each; },
  functions: function() { return functions; },
  get: function() { return get; },
  groupBy: function() { return groupBy; },
  has: function() { return has_has; },
  head: function() { return first; },
  identity: function() { return identity; },
  include: function() { return contains; },
  includes: function() { return contains; },
  indexBy: function() { return indexBy; },
  indexOf: function() { return indexOf; },
  initial: function() { return initial; },
  inject: function() { return reduce; },
  intersection: function() { return intersection; },
  invert: function() { return invert; },
  invoke: function() { return invoke; },
  isArguments: function() { return modules_isArguments; },
  isArray: function() { return isArray; },
  isArrayBuffer: function() { return isArrayBuffer; },
  isBoolean: function() { return isBoolean; },
  isDataView: function() { return modules_isDataView; },
  isDate: function() { return isDate; },
  isElement: function() { return isElement; },
  isEmpty: function() { return isEmpty; },
  isEqual: function() { return isEqual; },
  isError: function() { return isError; },
  isFinite: function() { return isFinite_isFinite; },
  isFunction: function() { return modules_isFunction; },
  isMap: function() { return isMap; },
  isMatch: function() { return isMatch; },
  isNaN: function() { return isNaN_isNaN; },
  isNull: function() { return isNull; },
  isNumber: function() { return isNumber; },
  isObject: function() { return isObject; },
  isRegExp: function() { return isRegExp; },
  isSet: function() { return isSet; },
  isString: function() { return isString; },
  isSymbol: function() { return isSymbol; },
  isTypedArray: function() { return modules_isTypedArray; },
  isUndefined: function() { return isUndefined; },
  isWeakMap: function() { return isWeakMap; },
  isWeakSet: function() { return isWeakSet; },
  iteratee: function() { return iteratee; },
  keys: function() { return keys; },
  last: function() { return last; },
  lastIndexOf: function() { return lastIndexOf; },
  map: function() { return map; },
  mapObject: function() { return mapObject; },
  matcher: function() { return matcher; },
  matches: function() { return matcher; },
  max: function() { return max; },
  memoize: function() { return memoize; },
  methods: function() { return functions; },
  min: function() { return min; },
  mixin: function() { return mixin; },
  negate: function() { return negate; },
  noop: function() { return noop; },
  now: function() { return now; },
  object: function() { return object; },
  omit: function() { return omit; },
  once: function() { return once; },
  pairs: function() { return pairs; },
  partial: function() { return modules_partial; },
  partition: function() { return partition; },
  pick: function() { return pick; },
  pluck: function() { return pluck; },
  property: function() { return property; },
  propertyOf: function() { return propertyOf; },
  random: function() { return random; },
  range: function() { return range; },
  reduce: function() { return reduce; },
  reduceRight: function() { return reduceRight; },
  reject: function() { return reject; },
  rest: function() { return rest; },
  restArguments: function() { return restArguments; },
  result: function() { return result; },
  sample: function() { return sample; },
  select: function() { return filter; },
  shuffle: function() { return shuffle; },
  size: function() { return size; },
  some: function() { return some; },
  sortBy: function() { return sortBy; },
  sortedIndex: function() { return sortedIndex; },
  tail: function() { return rest; },
  take: function() { return first; },
  tap: function() { return tap; },
  template: function() { return template; },
  templateSettings: function() { return templateSettings; },
  throttle: function() { return throttle; },
  times: function() { return times; },
  toArray: function() { return toArray; },
  toPath: function() { return toPath; },
  transpose: function() { return unzip; },
  unescape: function() { return modules_unescape; },
  union: function() { return union; },
  uniq: function() { return uniq; },
  unique: function() { return uniq; },
  uniqueId: function() { return uniqueId; },
  unzip: function() { return unzip; },
  values: function() { return values; },
  where: function() { return where; },
  without: function() { return without; },
  wrap: function() { return wrap; },
  zip: function() { return zip; }
});

;// ./node_modules/underscore/modules/_setup.js
// Current version.
var VERSION = '1.13.8';

// Establish the root object, `window` (`self`) in the browser, `global`
// on the server, or `this` in some virtual machines. We use `self`
// instead of `window` for `WebWorker` support.
var root = (typeof self == 'object' && self.self === self && self) ||
          (typeof global == 'object' && global.global === global && global) ||
          Function('return this')() ||
          {};

// Save bytes in the minified (but not gzipped) version:
var ArrayProto = Array.prototype, ObjProto = Object.prototype;
var SymbolProto = typeof Symbol !== 'undefined' ? Symbol.prototype : null;

// Create quick reference variables for speed access to core prototypes.
var push = ArrayProto.push,
    slice = ArrayProto.slice,
    _setup_toString = ObjProto.toString,
    _setup_hasOwnProperty = ObjProto.hasOwnProperty;

// Modern feature detection.
var supportsArrayBuffer = typeof ArrayBuffer !== 'undefined',
    supportsDataView = typeof DataView !== 'undefined';

// All **ECMAScript 5+** native function implementations that we hope to use
// are declared here.
var nativeIsArray = Array.isArray,
    nativeKeys = Object.keys,
    nativeCreate = Object.create,
    nativeIsView = supportsArrayBuffer && ArrayBuffer.isView;

// Create references to these builtin functions because we override them.
var _isNaN = isNaN,
    _isFinite = isFinite;

// Keys in IE < 9 that won't be iterated by `for key in ...` and thus missed.
var hasEnumBug = !{toString: null}.propertyIsEnumerable('toString');
var nonEnumerableProps = ['valueOf', 'isPrototypeOf', 'toString',
  'propertyIsEnumerable', 'hasOwnProperty', 'toLocaleString'];

// The largest integer that can be represented exactly.
var MAX_ARRAY_INDEX = Math.pow(2, 53) - 1;

;// ./node_modules/underscore/modules/restArguments.js
// Some functions take a variable number of arguments, or a few expected
// arguments at the beginning and then a variable number of values to operate
// on. This helper accumulates all remaining arguments past the function’s
// argument length (or an explicit `startIndex`), into an array that becomes
// the last argument. Similar to ES6’s "rest parameter".
function restArguments(func, startIndex) {
  startIndex = startIndex == null ? func.length - 1 : +startIndex;
  return function() {
    var length = Math.max(arguments.length - startIndex, 0),
        rest = Array(length),
        index = 0;
    for (; index < length; index++) {
      rest[index] = arguments[index + startIndex];
    }
    switch (startIndex) {
      case 0: return func.call(this, rest);
      case 1: return func.call(this, arguments[0], rest);
      case 2: return func.call(this, arguments[0], arguments[1], rest);
    }
    var args = Array(startIndex + 1);
    for (index = 0; index < startIndex; index++) {
      args[index] = arguments[index];
    }
    args[startIndex] = rest;
    return func.apply(this, args);
  };
}

;// ./node_modules/underscore/modules/isObject.js
// Is a given variable an object?
function isObject(obj) {
  var type = typeof obj;
  return type === 'function' || (type === 'object' && !!obj);
}

;// ./node_modules/underscore/modules/isNull.js
// Is a given value equal to null?
function isNull(obj) {
  return obj === null;
}

;// ./node_modules/underscore/modules/isUndefined.js
// Is a given variable undefined?
function isUndefined(obj) {
  return obj === void 0;
}

;// ./node_modules/underscore/modules/isBoolean.js


// Is a given value a boolean?
function isBoolean(obj) {
  return obj === true || obj === false || _setup_toString.call(obj) === '[object Boolean]';
}

;// ./node_modules/underscore/modules/isElement.js
// Is a given value a DOM element?
function isElement(obj) {
  return !!(obj && obj.nodeType === 1);
}

;// ./node_modules/underscore/modules/_tagTester.js


// Internal function for creating a `toString`-based type tester.
function tagTester(name) {
  var tag = '[object ' + name + ']';
  return function(obj) {
    return _setup_toString.call(obj) === tag;
  };
}

;// ./node_modules/underscore/modules/isString.js


/* harmony default export */ var isString = (tagTester('String'));

;// ./node_modules/underscore/modules/isNumber.js


/* harmony default export */ var isNumber = (tagTester('Number'));

;// ./node_modules/underscore/modules/isDate.js


/* harmony default export */ var isDate = (tagTester('Date'));

;// ./node_modules/underscore/modules/isRegExp.js


/* harmony default export */ var isRegExp = (tagTester('RegExp'));

;// ./node_modules/underscore/modules/isError.js


/* harmony default export */ var isError = (tagTester('Error'));

;// ./node_modules/underscore/modules/isSymbol.js


/* harmony default export */ var isSymbol = (tagTester('Symbol'));

;// ./node_modules/underscore/modules/isArrayBuffer.js


/* harmony default export */ var isArrayBuffer = (tagTester('ArrayBuffer'));

;// ./node_modules/underscore/modules/isFunction.js



var isFunction = tagTester('Function');

// Optimize `isFunction` if appropriate. Work around some `typeof` bugs in old
// v8, IE 11 (#1621), Safari 8 (#1929), and PhantomJS (#2236).
var nodelist = root.document && root.document.childNodes;
if ( true && typeof Int8Array != 'object' && typeof nodelist != 'function') {
  isFunction = function(obj) {
    return typeof obj == 'function' || false;
  };
}

/* harmony default export */ var modules_isFunction = (isFunction);

;// ./node_modules/underscore/modules/_hasObjectTag.js


/* harmony default export */ var _hasObjectTag = (tagTester('Object'));

;// ./node_modules/underscore/modules/_stringTagBug.js



// In IE 10 - Edge 13, `DataView` has string tag `'[object Object]'`.
// In IE 11, the most common among them, this problem also applies to
// `Map`, `WeakMap` and `Set`.
// Also, there are cases where an application can override the native
// `DataView` object, in cases like that we can't use the constructor
// safely and should just rely on alternate `DataView` checks
var hasDataViewBug = (
      supportsDataView && (!/\[native code\]/.test(String(DataView)) || _hasObjectTag(new DataView(new ArrayBuffer(8))))
    ),
    isIE11 = (typeof Map !== 'undefined' && _hasObjectTag(new Map));

;// ./node_modules/underscore/modules/isDataView.js





var isDataView = tagTester('DataView');

// In IE 10 - Edge 13, we need a different heuristic
// to determine whether an object is a `DataView`.
// Also, in cases where the native `DataView` is
// overridden we can't rely on the tag itself.
function alternateIsDataView(obj) {
  return obj != null && modules_isFunction(obj.getInt8) && isArrayBuffer(obj.buffer);
}

/* harmony default export */ var modules_isDataView = (hasDataViewBug ? alternateIsDataView : isDataView);

;// ./node_modules/underscore/modules/isArray.js



// Is a given value an array?
// Delegates to ECMA5's native `Array.isArray`.
/* harmony default export */ var isArray = (nativeIsArray || tagTester('Array'));

;// ./node_modules/underscore/modules/_has.js


// Internal function to check whether `key` is an own property name of `obj`.
function has(obj, key) {
  return obj != null && _setup_hasOwnProperty.call(obj, key);
}

;// ./node_modules/underscore/modules/isArguments.js



var isArguments = tagTester('Arguments');

// Define a fallback version of the method in browsers (ahem, IE < 9), where
// there isn't any inspectable "Arguments" type.
(function() {
  if (!isArguments(arguments)) {
    isArguments = function(obj) {
      return has(obj, 'callee');
    };
  }
}());

/* harmony default export */ var modules_isArguments = (isArguments);

;// ./node_modules/underscore/modules/isFinite.js



// Is a given object a finite number?
function isFinite_isFinite(obj) {
  return !isSymbol(obj) && _isFinite(obj) && !isNaN(parseFloat(obj));
}

;// ./node_modules/underscore/modules/isNaN.js



// Is the given value `NaN`?
function isNaN_isNaN(obj) {
  return isNumber(obj) && _isNaN(obj);
}

;// ./node_modules/underscore/modules/constant.js
// Predicate-generating function. Often useful outside of Underscore.
function constant(value) {
  return function() {
    return value;
  };
}

;// ./node_modules/underscore/modules/_createSizePropertyCheck.js


// Common internal logic for `isArrayLike` and `isBufferLike`.
function createSizePropertyCheck(getSizeProperty) {
  return function(collection) {
    var sizeProperty = getSizeProperty(collection);
    return typeof sizeProperty == 'number' && sizeProperty >= 0 && sizeProperty <= MAX_ARRAY_INDEX;
  }
}

;// ./node_modules/underscore/modules/_shallowProperty.js
// Internal helper to generate a function to obtain property `key` from `obj`.
function shallowProperty(key) {
  return function(obj) {
    return obj == null ? void 0 : obj[key];
  };
}

;// ./node_modules/underscore/modules/_getByteLength.js


// Internal helper to obtain the `byteLength` property of an object.
/* harmony default export */ var _getByteLength = (shallowProperty('byteLength'));

;// ./node_modules/underscore/modules/_isBufferLike.js



// Internal helper to determine whether we should spend extensive checks against
// `ArrayBuffer` et al.
/* harmony default export */ var _isBufferLike = (createSizePropertyCheck(_getByteLength));

;// ./node_modules/underscore/modules/isTypedArray.js





// Is a given value a typed array?
var typedArrayPattern = /\[object ((I|Ui)nt(8|16|32)|Float(32|64)|Uint8Clamped|Big(I|Ui)nt64)Array\]/;
function isTypedArray(obj) {
  // `ArrayBuffer.isView` is the most future-proof, so use it when available.
  // Otherwise, fall back on the above regular expression.
  return nativeIsView ? (nativeIsView(obj) && !modules_isDataView(obj)) :
                _isBufferLike(obj) && typedArrayPattern.test(_setup_toString.call(obj));
}

/* harmony default export */ var modules_isTypedArray = (supportsArrayBuffer ? isTypedArray : constant(false));

;// ./node_modules/underscore/modules/_getLength.js


// Internal helper to obtain the `length` property of an object.
/* harmony default export */ var _getLength = (shallowProperty('length'));

;// ./node_modules/underscore/modules/_collectNonEnumProps.js




// Internal helper to create a simple lookup structure.
// `collectNonEnumProps` used to depend on `_.contains`, but this led to
// circular imports. `emulatedSet` is a one-off solution that only works for
// arrays of strings.
function emulatedSet(keys) {
  var hash = {};
  for (var l = keys.length, i = 0; i < l; ++i) hash[keys[i]] = true;
  return {
    contains: function(key) { return hash[key] === true; },
    push: function(key) {
      hash[key] = true;
      return keys.push(key);
    }
  };
}

// Internal helper. Checks `keys` for the presence of keys in IE < 9 that won't
// be iterated by `for key in ...` and thus missed. Extends `keys` in place if
// needed.
function collectNonEnumProps(obj, keys) {
  keys = emulatedSet(keys);
  var nonEnumIdx = nonEnumerableProps.length;
  var constructor = obj.constructor;
  var proto = (modules_isFunction(constructor) && constructor.prototype) || ObjProto;

  // Constructor is a special case.
  var prop = 'constructor';
  if (has(obj, prop) && !keys.contains(prop)) keys.push(prop);

  while (nonEnumIdx--) {
    prop = nonEnumerableProps[nonEnumIdx];
    if (prop in obj && obj[prop] !== proto[prop] && !keys.contains(prop)) {
      keys.push(prop);
    }
  }
}

;// ./node_modules/underscore/modules/keys.js





// Retrieve the names of an object's own properties.
// Delegates to **ECMAScript 5**'s native `Object.keys`.
function keys(obj) {
  if (!isObject(obj)) return [];
  if (nativeKeys) return nativeKeys(obj);
  var keys = [];
  for (var key in obj) if (has(obj, key)) keys.push(key);
  // Ahem, IE < 9.
  if (hasEnumBug) collectNonEnumProps(obj, keys);
  return keys;
}

;// ./node_modules/underscore/modules/isEmpty.js






// Is a given array, string, or object empty?
// An "empty" object has no enumerable own-properties.
function isEmpty(obj) {
  if (obj == null) return true;
  // Skip the more expensive `toString`-based type checks if `obj` has no
  // `.length`.
  var length = _getLength(obj);
  if (typeof length == 'number' && (
    isArray(obj) || isString(obj) || modules_isArguments(obj)
  )) return length === 0;
  return _getLength(keys(obj)) === 0;
}

;// ./node_modules/underscore/modules/isMatch.js


// Returns whether an object has a given set of `key:value` pairs.
function isMatch(object, attrs) {
  var _keys = keys(attrs), length = _keys.length;
  if (object == null) return !length;
  var obj = Object(object);
  for (var i = 0; i < length; i++) {
    var key = _keys[i];
    if (attrs[key] !== obj[key] || !(key in obj)) return false;
  }
  return true;
}

;// ./node_modules/underscore/modules/underscore.js


// If Underscore is called as a function, it returns a wrapped object that can
// be used OO-style. This wrapper holds altered versions of all functions added
// through `_.mixin`. Wrapped objects may be chained.
function _(obj) {
  if (obj instanceof _) return obj;
  if (!(this instanceof _)) return new _(obj);
  this._wrapped = obj;
}

_.VERSION = VERSION;

// Extracts the result from a wrapped and chained object.
_.prototype.value = function() {
  return this._wrapped;
};

// Provide unwrapping proxies for some methods used in engine operations
// such as arithmetic and JSON stringification.
_.prototype.valueOf = _.prototype.toJSON = _.prototype.value;

_.prototype.toString = function() {
  return String(this._wrapped);
};

;// ./node_modules/underscore/modules/_toBufferView.js


// Internal function to wrap or shallow-copy an ArrayBuffer,
// typed array or DataView to a new view, reusing the buffer.
function toBufferView(bufferSource) {
  return new Uint8Array(
    bufferSource.buffer || bufferSource,
    bufferSource.byteOffset || 0,
    _getByteLength(bufferSource)
  );
}

;// ./node_modules/underscore/modules/isEqual.js











// We use this string twice, so give it a name for minification.
var tagDataView = '[object DataView]';

// Perform a deep comparison to check if two objects are equal.
function isEqual(a, b) {
  var todo = [{a: a, b: b}];
  // Initializing stacks of traversed objects for cycle detection.
  var aStack = [], bStack = [];

  while (todo.length) {
    var frame = todo.pop();
    if (frame === true) {
      // Remove the first object from the stack of traversed objects.
      aStack.pop();
      bStack.pop();
      continue;
    }
    a = frame.a;
    b = frame.b;

    // Identical objects are equal. `0 === -0`, but they aren't identical.
    // See the [Harmony `egal` proposal](https://wiki.ecmascript.org/doku.php?id=harmony:egal).
    if (a === b) {
      if (a !== 0 || 1 / a === 1 / b) continue;
      return false;
    }
    // `null` or `undefined` only equal to itself (strict comparison).
    if (a == null || b == null) return false;
    // `NaN`s are equivalent, but non-reflexive.
    if (a !== a) {
      if (b !== b) continue;
      return false;
    }
    // Exhaust primitive checks
    var type = typeof a;
    if (type !== 'function' && type !== 'object' && typeof b != 'object') return false;

// Internal recursive comparison function for `_.isEqual`.
    // Unwrap any wrapped objects.
    if (a instanceof _) a = a._wrapped;
    if (b instanceof _) b = b._wrapped;
    // Compare `[[Class]]` names.
    var className = _setup_toString.call(a);
    if (className !== _setup_toString.call(b)) return false;
    // Work around a bug in IE 10 - Edge 13.
    if (hasDataViewBug && className == '[object Object]' && modules_isDataView(a)) {
      if (!modules_isDataView(b)) return false;
      className = tagDataView;
    }
    switch (className) {
      // These types are compared by value.
    case '[object RegExp]':
      // RegExps are coerced to strings for comparison (Note: '' + /a/i === '/a/i')
    case '[object String]':
      // Primitives and their corresponding object wrappers are equivalent; thus, `"5"` is
      // equivalent to `new String("5")`.
      if ('' + a === '' + b) continue;
      return false;
    case '[object Number]':
      todo.push({a: +a, b: +b});
      continue;
    case '[object Date]':
    case '[object Boolean]':
      // Coerce dates and booleans to numeric primitive values. Dates are compared by their
      // millisecond representations. Note that invalid dates with millisecond representations
      // of `NaN` are not equivalent.
      if (+a === +b) continue;
      return false;
    case '[object Symbol]':
      if (SymbolProto.valueOf.call(a) === SymbolProto.valueOf.call(b)) continue;
      return false;
    case '[object ArrayBuffer]':
    case tagDataView:
      // Coerce to typed array so we can fall through.
      todo.push({a: toBufferView(a), b: toBufferView(b)});
      continue;
    }

    var areArrays = className === '[object Array]';
    if (!areArrays && modules_isTypedArray(a)) {
      var byteLength = _getByteLength(a);
      if (byteLength !== _getByteLength(b)) return false;
      if (a.buffer === b.buffer && a.byteOffset === b.byteOffset) continue;
      areArrays = true;
    }
    if (!areArrays) {
      if (typeof a != 'object' || typeof b != 'object') return false;

      // Objects with different constructors are not equivalent, but `Object`s or `Array`s
      // from different frames are.
      var aCtor = a.constructor, bCtor = b.constructor;
      if (aCtor !== bCtor && !(modules_isFunction(aCtor) && aCtor instanceof aCtor &&
                               modules_isFunction(bCtor) && bCtor instanceof bCtor)
          && ('constructor' in a && 'constructor' in b)) {
        return false;
      }
    }

    // Assume equality for cyclic structures. The algorithm for detecting cyclic
    // structures is adapted from ES 5.1 section 15.12.3, abstract operation `JO`.

    var length = aStack.length;
    while (length--) {
      // Linear search. Performance is inversely proportional to the number of
      // unique nested structures.
      if (aStack[length] === a) {
        if (bStack[length] === b) break;
        return false;
      }
    }
    if (length >= 0) continue;

    // Add the first object to the stack of traversed objects.
    aStack.push(a);
    bStack.push(b);
    todo.push(true);

    // Recursively compare objects and arrays.
    if (areArrays) {
      // Compare array lengths to determine if a deep comparison is necessary.
      length = a.length;
      if (length !== b.length) return false;
      // Deep compare the contents, ignoring non-numeric properties.
      while (length--) {
        todo.push({a: a[length], b: b[length]});
      }
    } else {
      // Deep compare objects.
      var _keys = keys(a), key;
      length = _keys.length;
      // Ensure that both objects contain the same number of properties before comparing deep equality.
      if (keys(b).length !== length) return false;
      while (length--) {
        // Deep compare each member
        key = _keys[length];
        if (!has(b, key)) return false;
        todo.push({a: a[key], b: b[key]});
      }
    }
  }
  return true;
}

;// ./node_modules/underscore/modules/allKeys.js




// Retrieve all the enumerable property names of an object.
function allKeys(obj) {
  if (!isObject(obj)) return [];
  var keys = [];
  for (var key in obj) keys.push(key);
  // Ahem, IE < 9.
  if (hasEnumBug) collectNonEnumProps(obj, keys);
  return keys;
}

;// ./node_modules/underscore/modules/_methodFingerprint.js




// Since the regular `Object.prototype.toString` type tests don't work for
// some types in IE 11, we use a fingerprinting heuristic instead, based
// on the methods. It's not great, but it's the best we got.
// The fingerprint method lists are defined below.
function ie11fingerprint(methods) {
  var length = _getLength(methods);
  return function(obj) {
    if (obj == null) return false;
    // `Map`, `WeakMap` and `Set` have no enumerable keys.
    var keys = allKeys(obj);
    if (_getLength(keys)) return false;
    for (var i = 0; i < length; i++) {
      if (!modules_isFunction(obj[methods[i]])) return false;
    }
    // If we are testing against `WeakMap`, we need to ensure that
    // `obj` doesn't have a `forEach` method in order to distinguish
    // it from a regular `Map`.
    return methods !== weakMapMethods || !modules_isFunction(obj[forEachName]);
  };
}

// In the interest of compact minification, we write
// each string in the fingerprints only once.
var forEachName = 'forEach',
    hasName = 'has',
    commonInit = ['clear', 'delete'],
    mapTail = ['get', hasName, 'set'];

// `Map`, `WeakMap` and `Set` each have slightly different
// combinations of the above sublists.
var mapMethods = commonInit.concat(forEachName, mapTail),
    weakMapMethods = commonInit.concat(mapTail),
    setMethods = ['add'].concat(commonInit, forEachName, hasName);

;// ./node_modules/underscore/modules/isMap.js




/* harmony default export */ var isMap = (isIE11 ? ie11fingerprint(mapMethods) : tagTester('Map'));

;// ./node_modules/underscore/modules/isWeakMap.js




/* harmony default export */ var isWeakMap = (isIE11 ? ie11fingerprint(weakMapMethods) : tagTester('WeakMap'));

;// ./node_modules/underscore/modules/isSet.js




/* harmony default export */ var isSet = (isIE11 ? ie11fingerprint(setMethods) : tagTester('Set'));

;// ./node_modules/underscore/modules/isWeakSet.js


/* harmony default export */ var isWeakSet = (tagTester('WeakSet'));

;// ./node_modules/underscore/modules/values.js


// Retrieve the values of an object's properties.
function values(obj) {
  var _keys = keys(obj);
  var length = _keys.length;
  var values = Array(length);
  for (var i = 0; i < length; i++) {
    values[i] = obj[_keys[i]];
  }
  return values;
}

;// ./node_modules/underscore/modules/pairs.js


// Convert an object into a list of `[key, value]` pairs.
// The opposite of `_.object` with one argument.
function pairs(obj) {
  var _keys = keys(obj);
  var length = _keys.length;
  var pairs = Array(length);
  for (var i = 0; i < length; i++) {
    pairs[i] = [_keys[i], obj[_keys[i]]];
  }
  return pairs;
}

;// ./node_modules/underscore/modules/invert.js


// Invert the keys and values of an object. The values must be serializable.
function invert(obj) {
  var result = {};
  var _keys = keys(obj);
  for (var i = 0, length = _keys.length; i < length; i++) {
    result[obj[_keys[i]]] = _keys[i];
  }
  return result;
}

;// ./node_modules/underscore/modules/functions.js


// Return a sorted list of the function names available on the object.
function functions(obj) {
  var names = [];
  for (var key in obj) {
    if (modules_isFunction(obj[key])) names.push(key);
  }
  return names.sort();
}

;// ./node_modules/underscore/modules/_createAssigner.js
// An internal function for creating assigner functions.
function createAssigner(keysFunc, defaults) {
  return function(obj) {
    var length = arguments.length;
    if (defaults) obj = Object(obj);
    if (length < 2 || obj == null) return obj;
    for (var index = 1; index < length; index++) {
      var source = arguments[index],
          keys = keysFunc(source),
          l = keys.length;
      for (var i = 0; i < l; i++) {
        var key = keys[i];
        if (!defaults || obj[key] === void 0) obj[key] = source[key];
      }
    }
    return obj;
  };
}

;// ./node_modules/underscore/modules/extend.js



// Extend a given object with all the properties in passed-in object(s).
/* harmony default export */ var extend = (createAssigner(allKeys));

;// ./node_modules/underscore/modules/extendOwn.js



// Assigns a given object with all the own properties in the passed-in
// object(s).
// (https://developer.mozilla.org/docs/Web/JavaScript/Reference/Global_Objects/Object/assign)
/* harmony default export */ var extendOwn = (createAssigner(keys));

;// ./node_modules/underscore/modules/defaults.js



// Fill in a given object with default properties.
/* harmony default export */ var defaults = (createAssigner(allKeys, true));

;// ./node_modules/underscore/modules/_baseCreate.js



// Create a naked function reference for surrogate-prototype-swapping.
function ctor() {
  return function(){};
}

// An internal function for creating a new object that inherits from another.
function baseCreate(prototype) {
  if (!isObject(prototype)) return {};
  if (nativeCreate) return nativeCreate(prototype);
  var Ctor = ctor();
  Ctor.prototype = prototype;
  var result = new Ctor;
  Ctor.prototype = null;
  return result;
}

;// ./node_modules/underscore/modules/create.js



// Creates an object that inherits from the given prototype object.
// If additional properties are provided then they will be added to the
// created object.
function create(prototype, props) {
  var result = baseCreate(prototype);
  if (props) extendOwn(result, props);
  return result;
}

;// ./node_modules/underscore/modules/clone.js




// Create a (shallow-cloned) duplicate of an object.
function clone(obj) {
  if (!isObject(obj)) return obj;
  return isArray(obj) ? obj.slice() : extend({}, obj);
}

;// ./node_modules/underscore/modules/tap.js
// Invokes `interceptor` with the `obj` and then returns `obj`.
// The primary purpose of this method is to "tap into" a method chain, in
// order to perform operations on intermediate results within the chain.
function tap(obj, interceptor) {
  interceptor(obj);
  return obj;
}

;// ./node_modules/underscore/modules/toPath.js



// Normalize a (deep) property `path` to array.
// Like `_.iteratee`, this function can be customized.
function toPath(path) {
  return isArray(path) ? path : [path];
}
_.toPath = toPath;

;// ./node_modules/underscore/modules/_toPath.js



// Internal wrapper for `_.toPath` to enable minification.
// Similar to `cb` for `_.iteratee`.
function _toPath_toPath(path) {
  return _.toPath(path);
}

;// ./node_modules/underscore/modules/_deepGet.js
// Internal function to obtain a nested property in `obj` along `path`.
function deepGet(obj, path) {
  var length = path.length;
  for (var i = 0; i < length; i++) {
    if (obj == null) return void 0;
    obj = obj[path[i]];
  }
  return length ? obj : void 0;
}

;// ./node_modules/underscore/modules/get.js




// Get the value of the (deep) property on `path` from `object`.
// If any property in `path` does not exist or if the value is
// `undefined`, return `defaultValue` instead.
// The `path` is normalized through `_.toPath`.
function get(object, path, defaultValue) {
  var value = deepGet(object, _toPath_toPath(path));
  return isUndefined(value) ? defaultValue : value;
}

;// ./node_modules/underscore/modules/has.js



// Shortcut function for checking if an object has a given property directly on
// itself (in other words, not on a prototype). Unlike the internal `has`
// function, this public version can also traverse nested properties.
function has_has(obj, path) {
  path = _toPath_toPath(path);
  var length = path.length;
  for (var i = 0; i < length; i++) {
    var key = path[i];
    if (!has(obj, key)) return false;
    obj = obj[key];
  }
  return !!length;
}

;// ./node_modules/underscore/modules/identity.js
// Keep the identity function around for default iteratees.
function identity(value) {
  return value;
}

;// ./node_modules/underscore/modules/matcher.js



// Returns a predicate for checking whether an object has a given set of
// `key:value` pairs.
function matcher(attrs) {
  attrs = extendOwn({}, attrs);
  return function(obj) {
    return isMatch(obj, attrs);
  };
}

;// ./node_modules/underscore/modules/property.js



// Creates a function that, when passed an object, will traverse that object’s
// properties down the given `path`, specified as an array of keys or indices.
function property(path) {
  path = _toPath_toPath(path);
  return function(obj) {
    return deepGet(obj, path);
  };
}

;// ./node_modules/underscore/modules/_optimizeCb.js
// Internal function that returns an efficient (for current engines) version
// of the passed-in callback, to be repeatedly applied in other Underscore
// functions.
function optimizeCb(func, context, argCount) {
  if (context === void 0) return func;
  switch (argCount == null ? 3 : argCount) {
    case 1: return function(value) {
      return func.call(context, value);
    };
    // The 2-argument case is omitted because we’re not using it.
    case 3: return function(value, index, collection) {
      return func.call(context, value, index, collection);
    };
    case 4: return function(accumulator, value, index, collection) {
      return func.call(context, accumulator, value, index, collection);
    };
  }
  return function() {
    return func.apply(context, arguments);
  };
}

;// ./node_modules/underscore/modules/_baseIteratee.js








// An internal function to generate callbacks that can be applied to each
// element in a collection, returning the desired result — either `_.identity`,
// an arbitrary callback, a property matcher, or a property accessor.
function baseIteratee(value, context, argCount) {
  if (value == null) return identity;
  if (modules_isFunction(value)) return optimizeCb(value, context, argCount);
  if (isObject(value) && !isArray(value)) return matcher(value);
  return property(value);
}

;// ./node_modules/underscore/modules/iteratee.js



// External wrapper for our callback generator. Users may customize
// `_.iteratee` if they want additional predicate/iteratee shorthand styles.
// This abstraction hides the internal-only `argCount` argument.
function iteratee(value, context) {
  return baseIteratee(value, context, Infinity);
}
_.iteratee = iteratee;

;// ./node_modules/underscore/modules/_cb.js




// The function we call internally to generate a callback. It invokes
// `_.iteratee` if overridden, otherwise `baseIteratee`.
function cb(value, context, argCount) {
  if (_.iteratee !== iteratee) return _.iteratee(value, context);
  return baseIteratee(value, context, argCount);
}

;// ./node_modules/underscore/modules/mapObject.js



// Returns the results of applying the `iteratee` to each element of `obj`.
// In contrast to `_.map` it returns an object.
function mapObject(obj, iteratee, context) {
  iteratee = cb(iteratee, context);
  var _keys = keys(obj),
      length = _keys.length,
      results = {};
  for (var index = 0; index < length; index++) {
    var currentKey = _keys[index];
    results[currentKey] = iteratee(obj[currentKey], currentKey, obj);
  }
  return results;
}

;// ./node_modules/underscore/modules/noop.js
// Predicate-generating function. Often useful outside of Underscore.
function noop(){}

;// ./node_modules/underscore/modules/propertyOf.js



// Generates a function for a given object that returns a given property.
function propertyOf(obj) {
  if (obj == null) return noop;
  return function(path) {
    return get(obj, path);
  };
}

;// ./node_modules/underscore/modules/times.js


// Run a function **n** times.
function times(n, iteratee, context) {
  var accum = Array(Math.max(0, n));
  iteratee = optimizeCb(iteratee, context, 1);
  for (var i = 0; i < n; i++) accum[i] = iteratee(i);
  return accum;
}

;// ./node_modules/underscore/modules/random.js
// Return a random integer between `min` and `max` (inclusive).
function random(min, max) {
  if (max == null) {
    max = min;
    min = 0;
  }
  return min + Math.floor(Math.random() * (max - min + 1));
}

;// ./node_modules/underscore/modules/now.js
// A (possibly faster) way to get the current timestamp as an integer.
/* harmony default export */ var now = (Date.now || function() {
  return new Date().getTime();
});

;// ./node_modules/underscore/modules/_createEscaper.js


// Internal helper to generate functions for escaping and unescaping strings
// to/from HTML interpolation.
function createEscaper(map) {
  var escaper = function(match) {
    return map[match];
  };
  // Regexes for identifying a key that needs to be escaped.
  var source = '(?:' + keys(map).join('|') + ')';
  var testRegexp = RegExp(source);
  var replaceRegexp = RegExp(source, 'g');
  return function(string) {
    string = string == null ? '' : '' + string;
    return testRegexp.test(string) ? string.replace(replaceRegexp, escaper) : string;
  };
}

;// ./node_modules/underscore/modules/_escapeMap.js
// Internal list of HTML entities for escaping.
/* harmony default export */ var _escapeMap = ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#x27;',
  '`': '&#x60;'
});

;// ./node_modules/underscore/modules/escape.js



// Function for escaping strings to HTML interpolation.
/* harmony default export */ var modules_escape = (createEscaper(_escapeMap));

;// ./node_modules/underscore/modules/_unescapeMap.js



// Internal list of HTML entities for unescaping.
/* harmony default export */ var _unescapeMap = (invert(_escapeMap));

;// ./node_modules/underscore/modules/unescape.js



// Function for unescaping strings from HTML interpolation.
/* harmony default export */ var modules_unescape = (createEscaper(_unescapeMap));

;// ./node_modules/underscore/modules/templateSettings.js


// By default, Underscore uses ERB-style template delimiters. Change the
// following template settings to use alternative delimiters.
/* harmony default export */ var templateSettings = (_.templateSettings = {
  evaluate: /<%([\s\S]+?)%>/g,
  interpolate: /<%=([\s\S]+?)%>/g,
  escape: /<%-([\s\S]+?)%>/g
});

;// ./node_modules/underscore/modules/template.js




// When customizing `_.templateSettings`, if you don't want to define an
// interpolation, evaluation or escaping regex, we need one that is
// guaranteed not to match.
var noMatch = /(.)^/;

// Certain characters need to be escaped so that they can be put into a
// string literal.
var escapes = {
  "'": "'",
  '\\': '\\',
  '\r': 'r',
  '\n': 'n',
  '\u2028': 'u2028',
  '\u2029': 'u2029'
};

var escapeRegExp = /\\|'|\r|\n|\u2028|\u2029/g;

function escapeChar(match) {
  return '\\' + escapes[match];
}

// In order to prevent third-party code injection through
// `_.templateSettings.variable`, we test it against the following regular
// expression. It is intentionally a bit more liberal than just matching valid
// identifiers, but still prevents possible loopholes through defaults or
// destructuring assignment.
var bareIdentifier = /^\s*(\w|\$)+\s*$/;

// JavaScript micro-templating, similar to John Resig's implementation.
// Underscore templating handles arbitrary delimiters, preserves whitespace,
// and correctly escapes quotes within interpolated code.
// NB: `oldSettings` only exists for backwards compatibility.
function template(text, settings, oldSettings) {
  if (!settings && oldSettings) settings = oldSettings;
  settings = defaults({}, settings, _.templateSettings);

  // Combine delimiters into one regular expression via alternation.
  var matcher = RegExp([
    (settings.escape || noMatch).source,
    (settings.interpolate || noMatch).source,
    (settings.evaluate || noMatch).source
  ].join('|') + '|$', 'g');

  // Compile the template source, escaping string literals appropriately.
  var index = 0;
  var source = "__p+='";
  text.replace(matcher, function(match, escape, interpolate, evaluate, offset) {
    source += text.slice(index, offset).replace(escapeRegExp, escapeChar);
    index = offset + match.length;

    if (escape) {
      source += "'+\n((__t=(" + escape + "))==null?'':_.escape(__t))+\n'";
    } else if (interpolate) {
      source += "'+\n((__t=(" + interpolate + "))==null?'':__t)+\n'";
    } else if (evaluate) {
      source += "';\n" + evaluate + "\n__p+='";
    }

    // Adobe VMs need the match returned to produce the correct offset.
    return match;
  });
  source += "';\n";

  var argument = settings.variable;
  if (argument) {
    // Insure against third-party code injection. (CVE-2021-23358)
    if (!bareIdentifier.test(argument)) throw new Error(
      'variable is not a bare identifier: ' + argument
    );
  } else {
    // If a variable is not specified, place data values in local scope.
    source = 'with(obj||{}){\n' + source + '}\n';
    argument = 'obj';
  }

  source = "var __t,__p='',__j=Array.prototype.join," +
    "print=function(){__p+=__j.call(arguments,'');};\n" +
    source + 'return __p;\n';

  var render;
  try {
    render = new Function(argument, '_', source);
  } catch (e) {
    e.source = source;
    throw e;
  }

  var template = function(data) {
    return render.call(this, data, _);
  };

  // Provide the compiled source as a convenience for precompilation.
  template.source = 'function(' + argument + '){\n' + source + '}';

  return template;
}

;// ./node_modules/underscore/modules/result.js



// Traverses the children of `obj` along `path`. If a child is a function, it
// is invoked with its parent as context. Returns the value of the final
// child, or `fallback` if any child is undefined.
function result(obj, path, fallback) {
  path = _toPath_toPath(path);
  var length = path.length;
  if (!length) {
    return modules_isFunction(fallback) ? fallback.call(obj) : fallback;
  }
  for (var i = 0; i < length; i++) {
    var prop = obj == null ? void 0 : obj[path[i]];
    if (prop === void 0) {
      prop = fallback;
      i = length; // Ensure we don't continue iterating.
    }
    obj = modules_isFunction(prop) ? prop.call(obj) : prop;
  }
  return obj;
}

;// ./node_modules/underscore/modules/uniqueId.js
// Generate a unique integer id (unique within the entire client session).
// Useful for temporary DOM ids.
var idCounter = 0;
function uniqueId(prefix) {
  var id = ++idCounter + '';
  return prefix ? prefix + id : id;
}

;// ./node_modules/underscore/modules/chain.js


// Start chaining a wrapped Underscore object.
function chain(obj) {
  var instance = _(obj);
  instance._chain = true;
  return instance;
}

;// ./node_modules/underscore/modules/_executeBound.js



// Internal function to execute `sourceFunc` bound to `context` with optional
// `args`. Determines whether to execute a function as a constructor or as a
// normal function.
function executeBound(sourceFunc, boundFunc, context, callingContext, args) {
  if (!(callingContext instanceof boundFunc)) return sourceFunc.apply(context, args);
  var self = baseCreate(sourceFunc.prototype);
  var result = sourceFunc.apply(self, args);
  if (isObject(result)) return result;
  return self;
}

;// ./node_modules/underscore/modules/partial.js




// Partially apply a function by creating a version that has had some of its
// arguments pre-filled, without changing its dynamic `this` context. `_` acts
// as a placeholder by default, allowing any combination of arguments to be
// pre-filled. Set `_.partial.placeholder` for a custom placeholder argument.
var partial = restArguments(function(func, boundArgs) {
  var placeholder = partial.placeholder;
  var bound = function() {
    var position = 0, length = boundArgs.length;
    var args = Array(length);
    for (var i = 0; i < length; i++) {
      args[i] = boundArgs[i] === placeholder ? arguments[position++] : boundArgs[i];
    }
    while (position < arguments.length) args.push(arguments[position++]);
    return executeBound(func, bound, this, this, args);
  };
  return bound;
});

partial.placeholder = _;
/* harmony default export */ var modules_partial = (partial);

;// ./node_modules/underscore/modules/bind.js




// Create a function bound to a given object (assigning `this`, and arguments,
// optionally).
/* harmony default export */ var bind = (restArguments(function(func, context, args) {
  if (!modules_isFunction(func)) throw new TypeError('Bind must be called on a function');
  var bound = restArguments(function(callArgs) {
    return executeBound(func, bound, context, this, args.concat(callArgs));
  });
  return bound;
}));

;// ./node_modules/underscore/modules/_isArrayLike.js



// Internal helper for collection methods to determine whether a collection
// should be iterated as an array or as an object.
// Related: https://people.mozilla.org/~jorendorff/es6-draft.html#sec-tolength
// Avoids a very nasty iOS 8 JIT bug on ARM-64. #2094
/* harmony default export */ var _isArrayLike = (createSizePropertyCheck(_getLength));

;// ./node_modules/underscore/modules/_flatten.js





// Internal implementation of a recursive `flatten` function.
function flatten(input, depth, strict) {
  if (!depth && depth !== 0) depth = Infinity;
  var output = [], idx = 0, i = 0, length = _getLength(input) || 0, stack = [];
  while (true) {
    if (i >= length) {
      if (!stack.length) break;
      var frame = stack.pop();
      i = frame.i;
      input = frame.v;
      length = _getLength(input);
      continue;
    }
    var value = input[i++];
    if (stack.length >= depth) {
      output[idx++] = value;
    } else if (_isArrayLike(value) && (isArray(value) || modules_isArguments(value))) {
      // Flatten current level of array or arguments object.
      stack.push({i: i, v: input});
      i = 0;
      input = value;
      length = _getLength(input);
    } else if (!strict) {
      output[idx++] = value;
    }
  }
  return output;
}

;// ./node_modules/underscore/modules/bindAll.js




// Bind a number of an object's methods to that object. Remaining arguments
// are the method names to be bound. Useful for ensuring that all callbacks
// defined on an object belong to it.
/* harmony default export */ var bindAll = (restArguments(function(obj, keys) {
  keys = flatten(keys, false, false);
  var index = keys.length;
  if (index < 1) throw new Error('bindAll must be passed function names');
  while (index--) {
    var key = keys[index];
    obj[key] = bind(obj[key], obj);
  }
  return obj;
}));

;// ./node_modules/underscore/modules/memoize.js


// Memoize an expensive function by storing its results.
function memoize(func, hasher) {
  var memoize = function(key) {
    var cache = memoize.cache;
    var address = '' + (hasher ? hasher.apply(this, arguments) : key);
    if (!has(cache, address)) cache[address] = func.apply(this, arguments);
    return cache[address];
  };
  memoize.cache = {};
  return memoize;
}

;// ./node_modules/underscore/modules/delay.js


// Delays a function for the given number of milliseconds, and then calls
// it with the arguments supplied.
/* harmony default export */ var delay = (restArguments(function(func, wait, args) {
  return setTimeout(function() {
    return func.apply(null, args);
  }, wait);
}));

;// ./node_modules/underscore/modules/defer.js




// Defers a function, scheduling it to run after the current call stack has
// cleared.
/* harmony default export */ var defer = (modules_partial(delay, _, 1));

;// ./node_modules/underscore/modules/throttle.js


// Returns a function, that, when invoked, will only be triggered at most once
// during a given window of time. Normally, the throttled function will run
// as much as it can, without ever going more than once per `wait` duration;
// but if you'd like to disable the execution on the leading edge, pass
// `{leading: false}`. To disable execution on the trailing edge, ditto.
function throttle(func, wait, options) {
  var timeout, context, args, result;
  var previous = 0;
  if (!options) options = {};

  var later = function() {
    previous = options.leading === false ? 0 : now();
    timeout = null;
    result = func.apply(context, args);
    if (!timeout) context = args = null;
  };

  var throttled = function() {
    var _now = now();
    if (!previous && options.leading === false) previous = _now;
    var remaining = wait - (_now - previous);
    context = this;
    args = arguments;
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      previous = _now;
      result = func.apply(context, args);
      if (!timeout) context = args = null;
    } else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining);
    }
    return result;
  };

  throttled.cancel = function() {
    clearTimeout(timeout);
    previous = 0;
    timeout = context = args = null;
  };

  return throttled;
}

;// ./node_modules/underscore/modules/debounce.js



// When a sequence of calls of the returned function ends, the argument
// function is triggered. The end of a sequence is defined by the `wait`
// parameter. If `immediate` is passed, the argument function will be
// triggered at the beginning of the sequence instead of at the end.
function debounce(func, wait, immediate) {
  var timeout, previous, args, result, context;

  var later = function() {
    var passed = now() - previous;
    if (wait > passed) {
      timeout = setTimeout(later, wait - passed);
    } else {
      timeout = null;
      if (!immediate) result = func.apply(context, args);
      // This check is needed because `func` can recursively invoke `debounced`.
      if (!timeout) args = context = null;
    }
  };

  var debounced = restArguments(function(_args) {
    context = this;
    args = _args;
    previous = now();
    if (!timeout) {
      timeout = setTimeout(later, wait);
      if (immediate) result = func.apply(context, args);
    }
    return result;
  });

  debounced.cancel = function() {
    clearTimeout(timeout);
    timeout = args = context = null;
  };

  return debounced;
}

;// ./node_modules/underscore/modules/wrap.js


// Returns the first function passed as an argument to the second,
// allowing you to adjust arguments, run code before and after, and
// conditionally execute the original function.
function wrap(func, wrapper) {
  return modules_partial(wrapper, func);
}

;// ./node_modules/underscore/modules/negate.js
// Returns a negated version of the passed-in predicate.
function negate(predicate) {
  return function() {
    return !predicate.apply(this, arguments);
  };
}

;// ./node_modules/underscore/modules/compose.js
// Returns a function that is the composition of a list of functions, each
// consuming the return value of the function that follows.
function compose() {
  var args = arguments;
  var start = args.length - 1;
  return function() {
    var i = start;
    var result = args[start].apply(this, arguments);
    while (i--) result = args[i].call(this, result);
    return result;
  };
}

;// ./node_modules/underscore/modules/after.js
// Returns a function that will only be executed on and after the Nth call.
function after(times, func) {
  return function() {
    if (--times < 1) {
      return func.apply(this, arguments);
    }
  };
}

;// ./node_modules/underscore/modules/before.js
// Returns a function that will only be executed up to (but not including) the
// Nth call.
function before(times, func) {
  var memo;
  return function() {
    if (--times > 0) {
      memo = func.apply(this, arguments);
    }
    if (times <= 1) func = null;
    return memo;
  };
}

;// ./node_modules/underscore/modules/once.js



// Returns a function that will be executed at most one time, no matter how
// often you call it. Useful for lazy initialization.
/* harmony default export */ var once = (modules_partial(before, 2));

;// ./node_modules/underscore/modules/findKey.js



// Returns the first key on an object that passes a truth test.
function findKey(obj, predicate, context) {
  predicate = cb(predicate, context);
  var _keys = keys(obj), key;
  for (var i = 0, length = _keys.length; i < length; i++) {
    key = _keys[i];
    if (predicate(obj[key], key, obj)) return key;
  }
}

;// ./node_modules/underscore/modules/_createPredicateIndexFinder.js



// Internal function to generate `_.findIndex` and `_.findLastIndex`.
function createPredicateIndexFinder(dir) {
  return function(array, predicate, context) {
    predicate = cb(predicate, context);
    var length = _getLength(array);
    var index = dir > 0 ? 0 : length - 1;
    for (; index >= 0 && index < length; index += dir) {
      if (predicate(array[index], index, array)) return index;
    }
    return -1;
  };
}

;// ./node_modules/underscore/modules/findIndex.js


// Returns the first index on an array-like that passes a truth test.
/* harmony default export */ var findIndex = (createPredicateIndexFinder(1));

;// ./node_modules/underscore/modules/findLastIndex.js


// Returns the last index on an array-like that passes a truth test.
/* harmony default export */ var findLastIndex = (createPredicateIndexFinder(-1));

;// ./node_modules/underscore/modules/sortedIndex.js



// Use a comparator function to figure out the smallest index at which
// an object should be inserted so as to maintain order. Uses binary search.
function sortedIndex(array, obj, iteratee, context) {
  iteratee = cb(iteratee, context, 1);
  var value = iteratee(obj);
  var low = 0, high = _getLength(array);
  while (low < high) {
    var mid = Math.floor((low + high) / 2);
    if (iteratee(array[mid]) < value) low = mid + 1; else high = mid;
  }
  return low;
}

;// ./node_modules/underscore/modules/_createIndexFinder.js




// Internal function to generate the `_.indexOf` and `_.lastIndexOf` functions.
function createIndexFinder(dir, predicateFind, sortedIndex) {
  return function(array, item, idx) {
    var i = 0, length = _getLength(array);
    if (typeof idx == 'number') {
      if (dir > 0) {
        i = idx >= 0 ? idx : Math.max(idx + length, i);
      } else {
        length = idx >= 0 ? Math.min(idx + 1, length) : idx + length + 1;
      }
    } else if (sortedIndex && idx && length) {
      idx = sortedIndex(array, item);
      return array[idx] === item ? idx : -1;
    }
    if (item !== item) {
      idx = predicateFind(slice.call(array, i, length), isNaN_isNaN);
      return idx >= 0 ? idx + i : -1;
    }
    for (idx = dir > 0 ? i : length - 1; idx >= 0 && idx < length; idx += dir) {
      if (array[idx] === item) return idx;
    }
    return -1;
  };
}

;// ./node_modules/underscore/modules/indexOf.js




// Return the position of the first occurrence of an item in an array,
// or -1 if the item is not included in the array.
// If the array is large and already in sort order, pass `true`
// for **isSorted** to use binary search.
/* harmony default export */ var indexOf = (createIndexFinder(1, findIndex, sortedIndex));

;// ./node_modules/underscore/modules/lastIndexOf.js



// Return the position of the last occurrence of an item in an array,
// or -1 if the item is not included in the array.
/* harmony default export */ var lastIndexOf = (createIndexFinder(-1, findLastIndex));

;// ./node_modules/underscore/modules/find.js




// Return the first value which passes a truth test.
function find(obj, predicate, context) {
  var keyFinder = _isArrayLike(obj) ? findIndex : findKey;
  var key = keyFinder(obj, predicate, context);
  if (key !== void 0 && key !== -1) return obj[key];
}

;// ./node_modules/underscore/modules/findWhere.js



// Convenience version of a common use case of `_.find`: getting the first
// object containing specific `key:value` pairs.
function findWhere(obj, attrs) {
  return find(obj, matcher(attrs));
}

;// ./node_modules/underscore/modules/each.js




// The cornerstone for collection functions, an `each`
// implementation, aka `forEach`.
// Handles raw objects in addition to array-likes. Treats all
// sparse array-likes as if they were dense.
function each(obj, iteratee, context) {
  iteratee = optimizeCb(iteratee, context);
  var i, length;
  if (_isArrayLike(obj)) {
    for (i = 0, length = obj.length; i < length; i++) {
      iteratee(obj[i], i, obj);
    }
  } else {
    var _keys = keys(obj);
    for (i = 0, length = _keys.length; i < length; i++) {
      iteratee(obj[_keys[i]], _keys[i], obj);
    }
  }
  return obj;
}

;// ./node_modules/underscore/modules/map.js




// Return the results of applying the iteratee to each element.
function map(obj, iteratee, context) {
  iteratee = cb(iteratee, context);
  var _keys = !_isArrayLike(obj) && keys(obj),
      length = (_keys || obj).length,
      results = Array(length);
  for (var index = 0; index < length; index++) {
    var currentKey = _keys ? _keys[index] : index;
    results[index] = iteratee(obj[currentKey], currentKey, obj);
  }
  return results;
}

;// ./node_modules/underscore/modules/_createReduce.js




// Internal helper to create a reducing function, iterating left or right.
function createReduce(dir) {
  // Wrap code that reassigns argument variables in a separate function than
  // the one that accesses `arguments.length` to avoid a perf hit. (#1991)
  var reducer = function(obj, iteratee, memo, initial) {
    var _keys = !_isArrayLike(obj) && keys(obj),
        length = (_keys || obj).length,
        index = dir > 0 ? 0 : length - 1;
    if (!initial) {
      memo = obj[_keys ? _keys[index] : index];
      index += dir;
    }
    for (; index >= 0 && index < length; index += dir) {
      var currentKey = _keys ? _keys[index] : index;
      memo = iteratee(memo, obj[currentKey], currentKey, obj);
    }
    return memo;
  };

  return function(obj, iteratee, memo, context) {
    var initial = arguments.length >= 3;
    return reducer(obj, optimizeCb(iteratee, context, 4), memo, initial);
  };
}

;// ./node_modules/underscore/modules/reduce.js


// **Reduce** builds up a single result from a list of values, aka `inject`,
// or `foldl`.
/* harmony default export */ var reduce = (createReduce(1));

;// ./node_modules/underscore/modules/reduceRight.js


// The right-associative version of reduce, also known as `foldr`.
/* harmony default export */ var reduceRight = (createReduce(-1));

;// ./node_modules/underscore/modules/filter.js



// Return all the elements that pass a truth test.
function filter(obj, predicate, context) {
  var results = [];
  predicate = cb(predicate, context);
  each(obj, function(value, index, list) {
    if (predicate(value, index, list)) results.push(value);
  });
  return results;
}

;// ./node_modules/underscore/modules/reject.js




// Return all the elements for which a truth test fails.
function reject(obj, predicate, context) {
  return filter(obj, negate(cb(predicate)), context);
}

;// ./node_modules/underscore/modules/every.js




// Determine whether all of the elements pass a truth test.
function every(obj, predicate, context) {
  predicate = cb(predicate, context);
  var _keys = !_isArrayLike(obj) && keys(obj),
      length = (_keys || obj).length;
  for (var index = 0; index < length; index++) {
    var currentKey = _keys ? _keys[index] : index;
    if (!predicate(obj[currentKey], currentKey, obj)) return false;
  }
  return true;
}

;// ./node_modules/underscore/modules/some.js




// Determine if at least one element in the object passes a truth test.
function some(obj, predicate, context) {
  predicate = cb(predicate, context);
  var _keys = !_isArrayLike(obj) && keys(obj),
      length = (_keys || obj).length;
  for (var index = 0; index < length; index++) {
    var currentKey = _keys ? _keys[index] : index;
    if (predicate(obj[currentKey], currentKey, obj)) return true;
  }
  return false;
}

;// ./node_modules/underscore/modules/contains.js




// Determine if the array or object contains a given item (using `===`).
function contains(obj, item, fromIndex, guard) {
  if (!_isArrayLike(obj)) obj = values(obj);
  if (typeof fromIndex != 'number' || guard) fromIndex = 0;
  return indexOf(obj, item, fromIndex) >= 0;
}

;// ./node_modules/underscore/modules/invoke.js






// Invoke a method (with arguments) on every item in a collection.
/* harmony default export */ var invoke = (restArguments(function(obj, path, args) {
  var contextPath, func;
  if (modules_isFunction(path)) {
    func = path;
  } else {
    path = _toPath_toPath(path);
    contextPath = path.slice(0, -1);
    path = path[path.length - 1];
  }
  return map(obj, function(context) {
    var method = func;
    if (!method) {
      if (contextPath && contextPath.length) {
        context = deepGet(context, contextPath);
      }
      if (context == null) return void 0;
      method = context[path];
    }
    return method == null ? method : method.apply(context, args);
  });
}));

;// ./node_modules/underscore/modules/pluck.js



// Convenience version of a common use case of `_.map`: fetching a property.
function pluck(obj, key) {
  return map(obj, property(key));
}

;// ./node_modules/underscore/modules/where.js



// Convenience version of a common use case of `_.filter`: selecting only
// objects containing specific `key:value` pairs.
function where(obj, attrs) {
  return filter(obj, matcher(attrs));
}

;// ./node_modules/underscore/modules/max.js





// Return the maximum element (or element-based computation).
function max(obj, iteratee, context) {
  var result = -Infinity, lastComputed = -Infinity,
      value, computed;
  if (iteratee == null || (typeof iteratee == 'number' && typeof obj[0] != 'object' && obj != null)) {
    obj = _isArrayLike(obj) ? obj : values(obj);
    for (var i = 0, length = obj.length; i < length; i++) {
      value = obj[i];
      if (value != null && value > result) {
        result = value;
      }
    }
  } else {
    iteratee = cb(iteratee, context);
    each(obj, function(v, index, list) {
      computed = iteratee(v, index, list);
      if (computed > lastComputed || (computed === -Infinity && result === -Infinity)) {
        result = v;
        lastComputed = computed;
      }
    });
  }
  return result;
}

;// ./node_modules/underscore/modules/min.js





// Return the minimum element (or element-based computation).
function min(obj, iteratee, context) {
  var result = Infinity, lastComputed = Infinity,
      value, computed;
  if (iteratee == null || (typeof iteratee == 'number' && typeof obj[0] != 'object' && obj != null)) {
    obj = _isArrayLike(obj) ? obj : values(obj);
    for (var i = 0, length = obj.length; i < length; i++) {
      value = obj[i];
      if (value != null && value < result) {
        result = value;
      }
    }
  } else {
    iteratee = cb(iteratee, context);
    each(obj, function(v, index, list) {
      computed = iteratee(v, index, list);
      if (computed < lastComputed || (computed === Infinity && result === Infinity)) {
        result = v;
        lastComputed = computed;
      }
    });
  }
  return result;
}

;// ./node_modules/underscore/modules/toArray.js








// Safely create a real, live array from anything iterable.
var reStrSymbol = /[^\ud800-\udfff]|[\ud800-\udbff][\udc00-\udfff]|[\ud800-\udfff]/g;
function toArray(obj) {
  if (!obj) return [];
  if (isArray(obj)) return slice.call(obj);
  if (isString(obj)) {
    // Keep surrogate pair characters together.
    return obj.match(reStrSymbol);
  }
  if (_isArrayLike(obj)) return map(obj, identity);
  return values(obj);
}

;// ./node_modules/underscore/modules/sample.js






// Sample **n** random values from a collection using the modern version of the
// [Fisher-Yates shuffle](https://en.wikipedia.org/wiki/Fisher–Yates_shuffle).
// If **n** is not specified, returns a single random element.
// The internal `guard` argument allows it to work with `_.map`.
function sample(obj, n, guard) {
  if (n == null || guard) {
    if (!_isArrayLike(obj)) obj = values(obj);
    return obj[random(obj.length - 1)];
  }
  var sample = toArray(obj);
  var length = _getLength(sample);
  n = Math.max(Math.min(n, length), 0);
  var last = length - 1;
  for (var index = 0; index < n; index++) {
    var rand = random(index, last);
    var temp = sample[index];
    sample[index] = sample[rand];
    sample[rand] = temp;
  }
  return sample.slice(0, n);
}

;// ./node_modules/underscore/modules/shuffle.js


// Shuffle a collection.
function shuffle(obj) {
  return sample(obj, Infinity);
}

;// ./node_modules/underscore/modules/sortBy.js




// Sort the object's values by a criterion produced by an iteratee.
function sortBy(obj, iteratee, context) {
  var index = 0;
  iteratee = cb(iteratee, context);
  return pluck(map(obj, function(value, key, list) {
    return {
      value: value,
      index: index++,
      criteria: iteratee(value, key, list)
    };
  }).sort(function(left, right) {
    var a = left.criteria;
    var b = right.criteria;
    if (a !== b) {
      if (a > b || a === void 0) return 1;
      if (a < b || b === void 0) return -1;
    }
    return left.index - right.index;
  }), 'value');
}

;// ./node_modules/underscore/modules/_group.js



// An internal function used for aggregate "group by" operations.
function group(behavior, partition) {
  return function(obj, iteratee, context) {
    var result = partition ? [[], []] : {};
    iteratee = cb(iteratee, context);
    each(obj, function(value, index) {
      var key = iteratee(value, index, obj);
      behavior(result, value, key);
    });
    return result;
  };
}

;// ./node_modules/underscore/modules/groupBy.js



// Groups the object's values by a criterion. Pass either a string attribute
// to group by, or a function that returns the criterion.
/* harmony default export */ var groupBy = (group(function(result, value, key) {
  if (has(result, key)) result[key].push(value); else result[key] = [value];
}));

;// ./node_modules/underscore/modules/indexBy.js


// Indexes the object's values by a criterion, similar to `_.groupBy`, but for
// when you know that your index values will be unique.
/* harmony default export */ var indexBy = (group(function(result, value, key) {
  result[key] = value;
}));

;// ./node_modules/underscore/modules/countBy.js



// Counts instances of an object that group by a certain criterion. Pass
// either a string attribute to count by, or a function that returns the
// criterion.
/* harmony default export */ var countBy = (group(function(result, value, key) {
  if (has(result, key)) result[key]++; else result[key] = 1;
}));

;// ./node_modules/underscore/modules/partition.js


// Split a collection into two arrays: one whose elements all pass the given
// truth test, and one whose elements all do not pass the truth test.
/* harmony default export */ var partition = (group(function(result, value, pass) {
  result[pass ? 0 : 1].push(value);
}, true));

;// ./node_modules/underscore/modules/size.js



// Return the number of elements in a collection.
function size(obj) {
  if (obj == null) return 0;
  return _isArrayLike(obj) ? obj.length : keys(obj).length;
}

;// ./node_modules/underscore/modules/_keyInObj.js
// Internal `_.pick` helper function to determine whether `key` is an enumerable
// property name of `obj`.
function keyInObj(value, key, obj) {
  return key in obj;
}

;// ./node_modules/underscore/modules/pick.js







// Return a copy of the object only containing the allowed properties.
/* harmony default export */ var pick = (restArguments(function(obj, keys) {
  var result = {}, iteratee = keys[0];
  if (obj == null) return result;
  if (modules_isFunction(iteratee)) {
    if (keys.length > 1) iteratee = optimizeCb(iteratee, keys[1]);
    keys = allKeys(obj);
  } else {
    iteratee = keyInObj;
    keys = flatten(keys, false, false);
    obj = Object(obj);
  }
  for (var i = 0, length = keys.length; i < length; i++) {
    var key = keys[i];
    var value = obj[key];
    if (iteratee(value, key, obj)) result[key] = value;
  }
  return result;
}));

;// ./node_modules/underscore/modules/omit.js








// Return a copy of the object without the disallowed properties.
/* harmony default export */ var omit = (restArguments(function(obj, keys) {
  var iteratee = keys[0], context;
  if (modules_isFunction(iteratee)) {
    iteratee = negate(iteratee);
    if (keys.length > 1) context = keys[1];
  } else {
    keys = map(flatten(keys, false, false), String);
    iteratee = function(value, key) {
      return !contains(keys, key);
    };
  }
  return pick(obj, iteratee, context);
}));

;// ./node_modules/underscore/modules/initial.js


// Returns everything but the last entry of the array. Especially useful on
// the arguments object. Passing **n** will return all the values in
// the array, excluding the last N.
function initial(array, n, guard) {
  return slice.call(array, 0, Math.max(0, array.length - (n == null || guard ? 1 : n)));
}

;// ./node_modules/underscore/modules/first.js


// Get the first element of an array. Passing **n** will return the first N
// values in the array. The **guard** check allows it to work with `_.map`.
function first(array, n, guard) {
  if (array == null || array.length < 1) return n == null || guard ? void 0 : [];
  if (n == null || guard) return array[0];
  return initial(array, array.length - n);
}

;// ./node_modules/underscore/modules/rest.js


// Returns everything but the first entry of the `array`. Especially useful on
// the `arguments` object. Passing an **n** will return the rest N values in the
// `array`.
function rest(array, n, guard) {
  return slice.call(array, n == null || guard ? 1 : n);
}

;// ./node_modules/underscore/modules/last.js


// Get the last element of an array. Passing **n** will return the last N
// values in the array.
function last(array, n, guard) {
  if (array == null || array.length < 1) return n == null || guard ? void 0 : [];
  if (n == null || guard) return array[array.length - 1];
  return rest(array, Math.max(0, array.length - n));
}

;// ./node_modules/underscore/modules/compact.js


// Trim out all falsy values from an array.
function compact(array) {
  return filter(array, Boolean);
}

;// ./node_modules/underscore/modules/flatten.js


// Flatten out an array, either recursively (by default), or up to `depth`.
// Passing `true` or `false` as `depth` means `1` or `Infinity`, respectively.
function flatten_flatten(array, depth) {
  return flatten(array, depth, false);
}

;// ./node_modules/underscore/modules/difference.js





// Take the difference between one array and a number of other arrays.
// Only the elements present in just the first array will remain.
/* harmony default export */ var difference = (restArguments(function(array, rest) {
  rest = flatten(rest, true, true);
  return filter(array, function(value){
    return !contains(rest, value);
  });
}));

;// ./node_modules/underscore/modules/without.js



// Return a version of the array that does not contain the specified value(s).
/* harmony default export */ var without = (restArguments(function(array, otherArrays) {
  return difference(array, otherArrays);
}));

;// ./node_modules/underscore/modules/uniq.js





// Produce a duplicate-free version of the array. If the array has already
// been sorted, you have the option of using a faster algorithm.
// The faster algorithm will not work with an iteratee if the iteratee
// is not a one-to-one function, so providing an iteratee will disable
// the faster algorithm.
function uniq(array, isSorted, iteratee, context) {
  if (!isBoolean(isSorted)) {
    context = iteratee;
    iteratee = isSorted;
    isSorted = false;
  }
  if (iteratee != null) iteratee = cb(iteratee, context);
  var result = [];
  var seen = [];
  for (var i = 0, length = _getLength(array); i < length; i++) {
    var value = array[i],
        computed = iteratee ? iteratee(value, i, array) : value;
    if (isSorted && !iteratee) {
      if (!i || seen !== computed) result.push(value);
      seen = computed;
    } else if (iteratee) {
      if (!contains(seen, computed)) {
        seen.push(computed);
        result.push(value);
      }
    } else if (!contains(result, value)) {
      result.push(value);
    }
  }
  return result;
}

;// ./node_modules/underscore/modules/union.js




// Produce an array that contains the union: each distinct element from all of
// the passed-in arrays.
/* harmony default export */ var union = (restArguments(function(arrays) {
  return uniq(flatten(arrays, true, true));
}));

;// ./node_modules/underscore/modules/intersection.js



// Produce an array that contains every item shared between all the
// passed-in arrays.
function intersection(array) {
  var result = [];
  var argsLength = arguments.length;
  for (var i = 0, length = _getLength(array); i < length; i++) {
    var item = array[i];
    if (contains(result, item)) continue;
    var j;
    for (j = 1; j < argsLength; j++) {
      if (!contains(arguments[j], item)) break;
    }
    if (j === argsLength) result.push(item);
  }
  return result;
}

;// ./node_modules/underscore/modules/unzip.js




// Complement of zip. Unzip accepts an array of arrays and groups
// each array's elements on shared indices.
function unzip(array) {
  var length = (array && max(array, _getLength).length) || 0;
  var result = Array(length);

  for (var index = 0; index < length; index++) {
    result[index] = pluck(array, index);
  }
  return result;
}

;// ./node_modules/underscore/modules/zip.js



// Zip together multiple lists into a single array -- elements that share
// an index go together.
/* harmony default export */ var zip = (restArguments(unzip));

;// ./node_modules/underscore/modules/object.js


// Converts lists into objects. Pass either a single array of `[key, value]`
// pairs, or two parallel arrays of the same length -- one of keys, and one of
// the corresponding values. Passing by pairs is the reverse of `_.pairs`.
function object(list, values) {
  var result = {};
  for (var i = 0, length = _getLength(list); i < length; i++) {
    if (values) {
      result[list[i]] = values[i];
    } else {
      result[list[i][0]] = list[i][1];
    }
  }
  return result;
}

;// ./node_modules/underscore/modules/range.js
// Generate an integer Array containing an arithmetic progression. A port of
// the native Python `range()` function. See
// [the Python documentation](https://docs.python.org/library/functions.html#range).
function range(start, stop, step) {
  if (stop == null) {
    stop = start || 0;
    start = 0;
  }
  if (!step) {
    step = stop < start ? -1 : 1;
  }

  var length = Math.max(Math.ceil((stop - start) / step), 0);
  var range = Array(length);

  for (var idx = 0; idx < length; idx++, start += step) {
    range[idx] = start;
  }

  return range;
}

;// ./node_modules/underscore/modules/chunk.js


// Chunk a single array into multiple arrays, each containing `count` or fewer
// items.
function chunk(array, count) {
  if (count == null || count < 1) return [];
  var result = [];
  var i = 0, length = array.length;
  while (i < length) {
    result.push(slice.call(array, i, i += count));
  }
  return result;
}

;// ./node_modules/underscore/modules/_chainResult.js


// Helper function to continue chaining intermediate results.
function chainResult(instance, obj) {
  return instance._chain ? _(obj).chain() : obj;
}

;// ./node_modules/underscore/modules/mixin.js






// Add your own custom functions to the Underscore object.
function mixin(obj) {
  each(functions(obj), function(name) {
    var func = _[name] = obj[name];
    _.prototype[name] = function() {
      var args = [this._wrapped];
      push.apply(args, arguments);
      return chainResult(this, func.apply(_, args));
    };
  });
  return _;
}

;// ./node_modules/underscore/modules/underscore-array-methods.js





// Add all mutator `Array` functions to the wrapper.
each(['pop', 'push', 'reverse', 'shift', 'sort', 'splice', 'unshift'], function(name) {
  var method = ArrayProto[name];
  _.prototype[name] = function() {
    var obj = this._wrapped;
    if (obj != null) {
      method.apply(obj, arguments);
      if ((name === 'shift' || name === 'splice') && obj.length === 0) {
        delete obj[0];
      }
    }
    return chainResult(this, obj);
  };
});

// Add all accessor `Array` functions to the wrapper.
each(['concat', 'join', 'slice'], function(name) {
  var method = ArrayProto[name];
  _.prototype[name] = function() {
    var obj = this._wrapped;
    if (obj != null) obj = method.apply(obj, arguments);
    return chainResult(this, obj);
  };
});

/* harmony default export */ var underscore_array_methods = (_);

;// ./node_modules/underscore/modules/index.js
// Named Exports
// =============

//     Underscore.js 1.13.8
//     https://underscorejs.org
//     (c) 2009-2026 Jeremy Ashkenas, Julian Gonggrijp, and DocumentCloud and Investigative Reporters & Editors
//     Underscore may be freely distributed under the MIT license.

// Baseline setup.



// Object Functions
// ----------------
// Our most fundamental functions operate on any JavaScript object.
// Most functions in Underscore depend on at least one function in this section.

// A group of functions that check the types of core JavaScript values.
// These are often informally referred to as the "isType" functions.



























// Functions that treat an object as a dictionary of key-value pairs.
















// Utility Functions
// -----------------
// A bit of a grab bag: Predicate-generating functions for use with filters and
// loops, string escaping and templating, create random numbers and unique ids,
// and functions that facilitate Underscore's chaining and iteration conventions.



















// Function (ahem) Functions
// -------------------------
// These functions take a function as an argument and return a new function
// as the result. Also known as higher-order functions.















// Finders
// -------
// Functions that extract (the position of) a single element from an object
// or array based on some criterion.









// Collection Functions
// --------------------
// Functions that work on any collection of elements: either an array, or
// an object of key-value pairs.
























// `_.pick` and `_.omit` are actually object functions, but we put
// them here in order to create a more natural reading order in the
// monolithic build as they depend on `_.contains`.



// Array Functions
// ---------------
// Functions that operate on arrays (and array-likes) only, because they’re
// expressed in terms of operations on an ordered list of values.

















// OOP
// ---
// These modules support the "object-oriented" calling style. See also
// `underscore.js` and `index-default.js`.



;// ./node_modules/underscore/modules/index-default.js
// Default Export
// ==============
// In this module, we mix our bundled exports into the `_` object and export
// the result. This is analogous to setting `module.exports = _` in CommonJS.
// Hence, this module is also the entry point of our UMD bundle and the package
// entry point for CommonJS and AMD users. In other words, this is (the source
// of) the module you are interfacing with when you do any of the following:
//
// ```js
// // CommonJS
// var _ = require('underscore');
//
// // AMD
// define(['underscore'], function(_) {...});
//
// // UMD in the browser
// // _ is available as a global variable
// ```



// Add all of the Underscore functions to the wrapper object.
var index_default_ = mixin(modules_namespaceObject);
// Legacy Node.js API.
index_default_._ = index_default_;
// Export the Underscore API.
/* harmony default export */ var index_default = (index_default_);

;// ./node_modules/underscore/modules/index-all.js
// ESM Exports
// ===========
// This module is the package entry point for ES module users. In other words,
// it is the module they are interfacing with when they import from the whole
// package instead of from a submodule, like this:
//
// ```js
// import { map } from 'underscore';
// ```
//
// The difference with `./index-default`, which is the package entry point for
// CommonJS, AMD and UMD users, is purely technical. In ES modules, named and
// default exports are considered to be siblings, so when you have a default
// export, its properties are not automatically available as named exports. For
// this reason, we re-export the named exports in addition to providing the same
// default export as in `./index-default`.




/***/ })

}]);
//# sourceMappingURL=306-680184b25915029ea063.js.map
'use strict';
const assert = require('node:assert/strict');
const Core = require('../app/src/main/assets/editor-core.js');
let checks = 0;
function check(value, expected) { assert.deepEqual(value, expected); checks++; }
const literal = Core.searchSpec('a.b', {regex:false,caseSensitive:true});
check(Core.findMatches('a.b axb A.B', literal).map(m=>m.from), [0]);
check(Core.findMatches('a.b A.B', Core.searchSpec('a.b', {})).map(m=>m.from), [0,4]);
check(Core.findMatches('cat cats scatter cat', Core.searchSpec('cat',{wholeWord:true})).map(m=>m.from), [0,17]);
check(Core.findMatches('α\nβ', Core.searchSpec('α\\nβ',{regex:true})).length, 1);
check(Core.findMatches('one\ntwo', Core.searchSpec('^',{regex:true})).map(m=>m.from), [0,4]);
check(Core.findMatches('abc', /(?:)/g).map(m=>m.from), [0,1,2,3]);
check(Core.findMatches('aaaa', /a/g, 2).length, 2);
check(Core.replaceAll('id=12 id=42', Core.searchSpec('id=(\\d+)',{regex:true}), '[$1]',true), {text:'[12] [42]',count:2});
check(Core.replaceAll('cat cat', Core.searchSpec('cat',{}), '$1',false), {text:'$1 $1',count:2});
check(Core.replaceAll('cat', /cat/g, '$$ $&',true), {text:'$ cat',count:1});
check(Core.replaceAll('a', /(a)/g, '$10 $2',true), {text:'a0 $2',count:1});
check(Core.replaceAll('a\nb', /^/gm, '>',true), {text:'>a\n>b',count:2});
check(Core.replaceAll('a', /(a)(b)?/g, '$2$1',true), {text:'a',count:1});
check(Core.sortLines('b\na\nc\n',false,false,false), 'a\nb\nc\n');
check(Core.sortLines('b\na\na',true,true,false), 'b\na');
check(Core.sortLines('b\nA\na',false,false,true), 'A\na\nb');
check(Core.normalize('a\r\nb\rc\n'), 'a\nb\nc\n');
check(Core.searchSpec('',{}), null);
assert.throws(()=>Core.searchSpec('[',{regex:true}),SyntaxError);checks++;
console.log('Editor helpers: '+checks+' checks passed.');
const samples=[
 ['#!/usr/bin/env python3\nprint("hello")','text/x-python'],
 ['#!/bin/bash\necho hello','text/x-sh'],
 ['if [ -d /tmp ]; then\n  export MODE=local\nfi','text/x-sh'],
 ['def greet(name):\n    return "hello"','text/x-python'],
 ['{"name":"AnoteP","offline":true}','application/json'],
 ['[1, 2, {"a":true}]','application/json'],
 ['<!DOCTYPE html>\n<html><body>Hello</body></html>','text/html'],
 ['<?xml version="1.0"?><root><a/></root>','application/xml'],
 ['const greet = name => { console.log(name); };','text/javascript'],
 ['interface User { name: string }\nconst user: User = {name: "A"};','text/typescript'],
 ['#include <iostream>\nint main() { std::cout << "hello"; }','text/x-c++src'],
 ['#include <stdio.h>\nint main() { printf("hello"); }','text/x-csrc'],
 ['public class Hello { public static void main(String[] args) { System.out.println("hi"); } }','text/x-java'],
 ['fun main() {\n val name: String = "A"\n}','text/x-kotlin'],
 ['package main\nfunc main() {fmt.Println("hello")}','text/x-go'],
 ['fn main() { println!("hello"); }','text/x-rustsrc'],
 ['.editor { color: green; padding: 10px; }','text/css'],
 ['SELECT name FROM notes WHERE active = 1;','text/x-sql'],
 ['# AnoteP\n- offline\n- [source](local.txt)','text/x-markdown'],
 ['name: AnoteP\nsettings:\n  offline: true','text/x-yaml'],
 ['FROM ubuntu:26.04\nRUN echo hello','text/x-dockerfile'],
 ['[editor]\nname = "AnoteP"','text/x-toml'],
 ['ordinary text about my day','text/plain'],['','text/plain']
];
for(const [source,mime]of samples)check(Core.detectLanguage(source),mime);
console.log('Language detection: '+samples.length+' checks passed.');

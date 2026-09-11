// ── Vault Code Editor (IDE) ───────────────────────────────────────
// Depends on: globals.js (fs, path, os, VAULT_DIR)
//             vault.js   (vaultData, vaultOpenFileId, vaultActiveFolderId,
//                         saveVaultData, renderVaultFolders, renderVaultGrid,
//                         openVaultFile)
// Requires: Ace Editor + xterm.js loaded from CDN

'use strict';

// ── Language registry ─────────────────────────────────────────────
const VAULT_CODE_LANGS = {
    python:     { label:'Python',      icon:'🐍', mode:'python',     ext:['py'],            cmd:'python3'        },
    javascript: { label:'JavaScript',  icon:'🟨', mode:'javascript', ext:['js','mjs'],      cmd:'node'           },
    typescript: { label:'TypeScript',  icon:'🔷', mode:'typescript', ext:['ts'],            cmd:'npx ts-node'    },
    shell:      { label:'Shell',       icon:'🐚', mode:'sh',         ext:['sh','bash','zsh'],cmd:'bash'          },
    go:         { label:'Go',          icon:'🐹', mode:'golang',     ext:['go'],            cmd:'go run'         },
    ruby:       { label:'Ruby',        icon:'💎', mode:'ruby',       ext:['rb'],            cmd:'ruby'           },
    c:          { label:'C',           icon:'🔵', mode:'c_cpp',      ext:['c'],             cmd:'__compile_c'    },
    cpp:        { label:'C++',         icon:'🔶', mode:'c_cpp',      ext:['cpp','cc','cxx'],cmd:'__compile_cpp'  },
    java:       { label:'Java',        icon:'☕', mode:'java',       ext:['java'],          cmd:'__compile_java' },
    rust:       { label:'Rust',        icon:'🦀', mode:'rust',       ext:['rs'],            cmd:'__compile_rust' },
    php:        { label:'PHP',         icon:'🐘', mode:'php',        ext:['php'],           cmd:'php'            },
    perl:       { label:'Perl',        icon:'🐪', mode:'perl',       ext:['pl','perl'],     cmd:'perl'           },
    r:          { label:'R',           icon:'📊', mode:'r',          ext:['r','R'],         cmd:'Rscript'        },
    html:       { label:'HTML',        icon:'🌐', mode:'html',       ext:['html','htm'],    cmd:null             },
    css:        { label:'CSS',         icon:'🎨', mode:'css',        ext:['css','scss'],    cmd:null             },
    json:       { label:'JSON',        icon:'📋', mode:'json',       ext:['json'],          cmd:null             },
    yaml:       { label:'YAML',        icon:'📄', mode:'yaml',       ext:['yaml','yml'],    cmd:null             },
    sql:        { label:'SQL',         icon:'🗃️', mode:'sql',        ext:['sql'],           cmd:null             },
    markdown:   { label:'Markdown',    icon:'📝', mode:'markdown',   ext:['md','markdown'], cmd:null             },
    text:       { label:'Plain Text',  icon:'📃', mode:'text',       ext:['txt'],           cmd:null             },
};

const CODE_FILE_EXTS = new Set(Object.values(VAULT_CODE_LANGS).flatMap(l => l.ext));
function isCodeFile(n) { return CODE_FILE_EXTS.has((n.split('.').pop()||'').toLowerCase()); }
function vaultCodeExtToLang(ext) {
    ext = ext.toLowerCase();
    for (const [k,v] of Object.entries(VAULT_CODE_LANGS)) if (v.ext.includes(ext)) return k;
    return 'text';
}

// ── Autocomplete database ─────────────────────────────────────────
// Each entry: { keywords[], builtins[], snippets[{cap, snip, meta, doc}] }
const LANG_COMPLETIONS = {
    python: {
        keywords: ['False','None','True','and','as','assert','async','await','break','class',
            'continue','def','del','elif','else','except','finally','for','from','global',
            'if','import','in','is','lambda','nonlocal','not','or','pass','raise','return',
            'try','while','with','yield'],
        builtins: ['abs','all','any','ascii','bin','bool','bytearray','bytes','callable','chr',
            'compile','complex','delattr','dict','dir','divmod','enumerate','eval','exec',
            'filter','float','format','frozenset','getattr','globals','hasattr','hash','help',
            'hex','id','input','int','isinstance','issubclass','iter','len','list','locals',
            'map','max','memoryview','min','next','object','oct','open','ord','pow','print',
            'property','range','repr','reversed','round','set','setattr','slice','sorted',
            'staticmethod','str','sum','super','tuple','type','vars','zip'],
        snippets: [
            {cap:'def',       snip:'def ${1:name}(${2:args}):\n    ${3:pass}',                              meta:'snippet', doc:'Define a function'},
            {cap:'class',     snip:'class ${1:Name}:\n    def __init__(self${2:, args}):\n        ${3:pass}',meta:'snippet', doc:'Define a class'},
            {cap:'for',       snip:'for ${1:item} in ${2:iterable}:\n    ${3:pass}',                       meta:'snippet', doc:'For loop'},
            {cap:'while',     snip:'while ${1:condition}:\n    ${2:pass}',                                 meta:'snippet', doc:'While loop'},
            {cap:'if',        snip:'if ${1:condition}:\n    ${2:pass}',                                    meta:'snippet', doc:'If statement'},
            {cap:'if else',   snip:'if ${1:condition}:\n    ${2:pass}\nelse:\n    ${3:pass}',              meta:'snippet', doc:'If-else statement'},
            {cap:'elif',      snip:'elif ${1:condition}:\n    ${2:pass}',                                  meta:'snippet', doc:'Elif branch'},
            {cap:'try',       snip:'try:\n    ${1:pass}\nexcept ${2:Exception} as ${3:e}:\n    ${4:pass}', meta:'snippet', doc:'Try-except'},
            {cap:'try finally',snip:'try:\n    ${1:pass}\nexcept ${2:Exception} as ${3:e}:\n    ${4:pass}\nfinally:\n    ${5:pass}', meta:'snippet', doc:'Try-except-finally'},
            {cap:'with',      snip:'with ${1:open("file")} as ${2:f}:\n    ${3:pass}',                    meta:'snippet', doc:'Context manager'},
            {cap:'import',    snip:'import ${1:module}',                                                   meta:'snippet', doc:'Import module'},
            {cap:'from import',snip:'from ${1:module} import ${2:name}',                                  meta:'snippet', doc:'From import'},
            {cap:'lambda',    snip:'lambda ${1:args}: ${2:expr}',                                          meta:'snippet', doc:'Lambda function'},
            {cap:'list comp', snip:'[${1:expr} for ${2:x} in ${3:iterable}]',                             meta:'snippet', doc:'List comprehension'},
            {cap:'dict comp', snip:'{${1:k}: ${2:v} for ${3:k}, ${4:v} in ${5:d}.items()}',              meta:'snippet', doc:'Dict comprehension'},
            {cap:'set comp',  snip:'{${1:expr} for ${2:x} in ${3:iterable}}',                             meta:'snippet', doc:'Set comprehension'},
            {cap:'main',      snip:'if __name__ == "__main__":\n    ${1:main()}',                         meta:'snippet', doc:'Main guard'},
            {cap:'dataclass', snip:'from dataclasses import dataclass\n\n@dataclass\nclass ${1:Name}:\n    ${2:field}: ${3:type}', meta:'snippet', doc:'Dataclass'},
            {cap:'print',     snip:'print(${1:"Hello"})',                                                  meta:'builtin', doc:'Print to stdout'},
            {cap:'range',     snip:'range(${1:10})',                                                       meta:'builtin', doc:'range(stop) or range(start,stop,step)'},
            {cap:'len',       snip:'len(${1:obj})',                                                        meta:'builtin', doc:'Return length'},
            {cap:'enumerate', snip:'enumerate(${1:iterable})',                                             meta:'builtin', doc:'Enumerate with index'},
            {cap:'zip',       snip:'zip(${1:a}, ${2:b})',                                                  meta:'builtin', doc:'Zip iterables'},
            {cap:'map',       snip:'map(${1:func}, ${2:iterable})',                                        meta:'builtin', doc:'Map function over iterable'},
            {cap:'filter',    snip:'filter(${1:func}, ${2:iterable})',                                     meta:'builtin', doc:'Filter iterable'},
            {cap:'sorted',    snip:'sorted(${1:iterable}, key=${2:lambda x: x})',                         meta:'builtin', doc:'Return sorted list'},
            {cap:'open',      snip:'open("${1:file}", "${2:r}")',                                          meta:'builtin', doc:'Open file'},
        ]
    },
    javascript: {
        keywords: ['async','await','break','case','catch','class','const','continue','debugger',
            'default','delete','do','else','export','extends','finally','for','from','function',
            'if','import','in','instanceof','let','new','of','return','static','super','switch',
            'throw','try','typeof','var','void','while','with','yield','null','undefined',
            'true','false','NaN','Infinity'],
        builtins: ['console','Math','JSON','Array','Object','String','Number','Boolean','Date',
            'RegExp','Error','Promise','Map','Set','WeakMap','WeakSet','Symbol','Proxy',
            'setTimeout','setInterval','clearTimeout','clearInterval','parseInt','parseFloat',
            'isNaN','isFinite','encodeURI','decodeURI','encodeURIComponent','fetch',
            'document','window','navigator','localStorage','sessionStorage','location'],
        snippets: [
            {cap:'function',      snip:'function ${1:name}(${2:args}) {\n    ${3}\n}',                     meta:'snippet', doc:'Function declaration'},
            {cap:'arrow',         snip:'const ${1:name} = (${2:args}) => {\n    ${3}\n};',                meta:'snippet', doc:'Arrow function'},
            {cap:'arrow short',   snip:'const ${1:name} = (${2:args}) => ${3:expr};',                    meta:'snippet', doc:'Arrow (expression)'},
            {cap:'async fn',      snip:'async function ${1:name}(${2:args}) {\n    ${3}\n}',              meta:'snippet', doc:'Async function'},
            {cap:'async arrow',   snip:'const ${1:name} = async (${2:args}) => {\n    ${3}\n};',         meta:'snippet', doc:'Async arrow'},
            {cap:'class',         snip:'class ${1:Name} {\n    constructor(${2:args}) {\n        ${3}\n    }\n}', meta:'snippet', doc:'Class declaration'},
            {cap:'class extends', snip:'class ${1:Name} extends ${2:Base} {\n    constructor(${3:args}) {\n        super(${3:args});\n        ${4}\n    }\n}', meta:'snippet', doc:'Class with extends'},
            {cap:'const',         snip:'const ${1:name} = ${2:value};',                                   meta:'snippet', doc:'Const declaration'},
            {cap:'let',           snip:'let ${1:name} = ${2:value};',                                     meta:'snippet', doc:'Let declaration'},
            {cap:'for',           snip:'for (let ${1:i} = 0; ${1:i} < ${2:arr}.length; ${1:i}++) {\n    ${3}\n}', meta:'snippet', doc:'For loop'},
            {cap:'forof',         snip:'for (const ${1:item} of ${2:arr}) {\n    ${3}\n}',               meta:'snippet', doc:'For-of loop'},
            {cap:'forin',         snip:'for (const ${1:key} in ${2:obj}) {\n    ${3}\n}',                meta:'snippet', doc:'For-in loop'},
            {cap:'while',         snip:'while (${1:condition}) {\n    ${2}\n}',                           meta:'snippet', doc:'While loop'},
            {cap:'if',            snip:'if (${1:condition}) {\n    ${2}\n}',                              meta:'snippet', doc:'If statement'},
            {cap:'if else',       snip:'if (${1:condition}) {\n    ${2}\n} else {\n    ${3}\n}',         meta:'snippet', doc:'If-else'},
            {cap:'ternary',       snip:'const ${1:val} = ${2:condition} ? ${3:a} : ${4:b};',             meta:'snippet', doc:'Ternary operator'},
            {cap:'switch',        snip:'switch (${1:expr}) {\n    case ${2:val}:\n        ${3}\n        break;\n    default:\n        break;\n}', meta:'snippet', doc:'Switch statement'},
            {cap:'try',           snip:'try {\n    ${1}\n} catch (${2:err}) {\n    console.error(${2:err});\n}', meta:'snippet', doc:'Try-catch'},
            {cap:'promise',       snip:'new Promise((${1:resolve}, ${2:reject}) => {\n    ${3}\n})',      meta:'snippet', doc:'New Promise'},
            {cap:'fetch',         snip:'const ${1:res} = await fetch("${2:url}");\nconst ${3:data} = await ${1:res}.json();', meta:'snippet', doc:'Fetch API'},
            {cap:'import',        snip:"import ${1:name} from '${2:module}';",                            meta:'snippet', doc:'ES6 import'},
            {cap:'import named',  snip:"import { ${1:name} } from '${2:module}';",                       meta:'snippet', doc:'Named import'},
            {cap:'export default', snip:'export default ${1:value};',                                    meta:'snippet', doc:'Default export'},
            {cap:'console.log',   snip:'console.log(${1});',                                              meta:'method',  doc:'Log to console'},
            {cap:'console.error', snip:'console.error(${1});',                                            meta:'method',  doc:'Error to console'},
            {cap:'JSON.parse',    snip:'JSON.parse(${1:str})',                                            meta:'method',  doc:'Parse JSON string'},
            {cap:'JSON.stringify',snip:'JSON.stringify(${1:obj}, null, ${2:2})',                          meta:'method',  doc:'Stringify to JSON'},
            {cap:'Object.keys',   snip:'Object.keys(${1:obj})',                                           meta:'method',  doc:'Get object keys'},
            {cap:'Array.from',    snip:'Array.from(${1:iterable})',                                      meta:'method',  doc:'Create array from iterable'},
            {cap:'setTimeout',    snip:'setTimeout(() => {\n    ${1}\n}, ${2:1000});',                   meta:'function',doc:'Delayed callback'},
            {cap:'addEventListener',snip:"${1:element}.addEventListener('${2:click}', (${3:e}) => {\n    ${4}\n});", meta:'method', doc:'Add event listener'},
        ]
    },
    typescript: {
        keywords: ['abstract','as','async','await','break','case','catch','class','const',
            'continue','declare','default','delete','do','else','enum','export','extends',
            'finally','for','from','function','if','implements','import','in','instanceof',
            'interface','let','new','of','override','private','protected','public','readonly',
            'return','static','super','switch','throw','try','type','typeof','var','void',
            'while','yield','null','undefined','true','false','never','any','unknown',
            'string','number','boolean','object','symbol','bigint'],
        builtins: ['console','Math','JSON','Array','Object','String','Number','Boolean','Date',
            'Promise','Map','Set','Record','Partial','Required','Readonly','Pick','Omit',
            'Exclude','Extract','ReturnType','Parameters','InstanceType','NonNullable',
            'setTimeout','setInterval','fetch'],
        snippets: [
            {cap:'interface',    snip:'interface ${1:Name} {\n    ${2:prop}: ${3:type};\n}',             meta:'snippet', doc:'Interface'},
            {cap:'type alias',   snip:'type ${1:Name} = ${2:string | number};',                         meta:'snippet', doc:'Type alias'},
            {cap:'generic type', snip:'type ${1:Name}<T> = ${2:T[]};',                                  meta:'snippet', doc:'Generic type'},
            {cap:'function',     snip:'function ${1:name}(${2:arg}: ${3:type}): ${4:void} {\n    ${5}\n}', meta:'snippet', doc:'Typed function'},
            {cap:'async fn',     snip:'async function ${1:name}(${2:args}): Promise<${3:void}> {\n    ${4}\n}', meta:'snippet', doc:'Async typed function'},
            {cap:'arrow',        snip:'const ${1:name} = (${2:arg}: ${3:type}): ${4:type} => {\n    ${5}\n};', meta:'snippet', doc:'Typed arrow'},
            {cap:'class',        snip:'class ${1:Name} {\n    constructor(private ${2:prop}: ${3:type}) {}\n\n    ${4:method}(): ${5:void} {\n        ${6}\n    }\n}', meta:'snippet', doc:'Class with constructor'},
            {cap:'enum',         snip:'enum ${1:Name} {\n    ${2:Value} = "${3:value}",\n}',            meta:'snippet', doc:'Enum'},
            {cap:'generic fn',   snip:'function ${1:name}<T>(${2:arg}: T): T {\n    return ${2:arg};\n}', meta:'snippet', doc:'Generic function'},
            {cap:'const typed',  snip:'const ${1:name}: ${2:type} = ${3:value};',                      meta:'snippet', doc:'Typed const'},
            {cap:'as type',      snip:'(${1:expr} as ${2:Type})',                                       meta:'snippet', doc:'Type assertion'},
        ]
    },
    go: {
        keywords: ['break','case','chan','const','continue','default','defer','else','fallthrough',
            'for','func','go','goto','if','import','interface','map','package','range',
            'return','select','struct','switch','type','var'],
        builtins: ['append','cap','close','complex','copy','delete','imag','len','make','new',
            'panic','print','println','real','recover'],
        snippets: [
            {cap:'func',      snip:'func ${1:name}(${2:args}) ${3:returnType} {\n\t${4}\n}',               meta:'snippet', doc:'Function'},
            {cap:'main',      snip:'package main\n\nimport "fmt"\n\nfunc main() {\n\t${1}\n}',             meta:'snippet', doc:'Main package'},
            {cap:'struct',    snip:'type ${1:Name} struct {\n\t${2:Field} ${3:type}\n}',                   meta:'snippet', doc:'Struct'},
            {cap:'interface', snip:'type ${1:Name} interface {\n\t${2:Method}() ${3:type}\n}',             meta:'snippet', doc:'Interface'},
            {cap:'for',       snip:'for ${1:i} := 0; ${1:i} < ${2:n}; ${1:i}++ {\n\t${3}\n}',            meta:'snippet', doc:'For loop'},
            {cap:'range',     snip:'for ${1:i}, ${2:v} := range ${3:arr} {\n\t${4}\n}',                   meta:'snippet', doc:'Range loop'},
            {cap:'if',        snip:'if ${1:condition} {\n\t${2}\n}',                                      meta:'snippet', doc:'If'},
            {cap:'if err',    snip:'if err != nil {\n\treturn ${1:err}\n}',                               meta:'snippet', doc:'Error check'},
            {cap:'goroutine', snip:'go func() {\n\t${1}\n}()',                                            meta:'snippet', doc:'Goroutine'},
            {cap:'channel',   snip:'${1:ch} := make(chan ${2:int})',                                      meta:'snippet', doc:'Channel'},
            {cap:'select',    snip:'select {\ncase ${1:v} := <-${2:ch}:\n\t${3}\ndefault:\n\t${4}\n}',   meta:'snippet', doc:'Select'},
            {cap:'defer',     snip:'defer ${1:func}()',                                                   meta:'snippet', doc:'Defer'},
            {cap:'fmt.Println',snip:'fmt.Println(${1})',                                                  meta:'method',  doc:'Print line'},
            {cap:'fmt.Printf', snip:'fmt.Printf("${1:%s}\\n", ${2:args})',                               meta:'method',  doc:'Printf'},
            {cap:'fmt.Sprintf',snip:'${1:s} := fmt.Sprintf("${2:%s}", ${3:args})',                       meta:'method',  doc:'Sprintf'},
        ]
    },
    rust: {
        keywords: ['as','async','await','break','const','continue','crate','dyn','else','enum',
            'extern','false','fn','for','if','impl','in','let','loop','match','mod','move',
            'mut','pub','ref','return','self','Self','static','struct','super','trait','true',
            'type','unsafe','use','where','while'],
        builtins: ['println!','print!','eprintln!','eprint!','format!','vec!','panic!','assert!',
            'assert_eq!','assert_ne!','todo!','unimplemented!','dbg!','include_str!',
            'Option','Result','Some','None','Ok','Err','Vec','String','str',
            'HashMap','HashSet','Box','Rc','Arc','Mutex','RwLock'],
        snippets: [
            {cap:'fn',        snip:'fn ${1:name}(${2:args}) -> ${3:ReturnType} {\n    ${4}\n}',           meta:'snippet', doc:'Function'},
            {cap:'main',      snip:'fn main() {\n    ${1}\n}',                                            meta:'snippet', doc:'Main function'},
            {cap:'struct',    snip:'struct ${1:Name} {\n    ${2:field}: ${3:Type},\n}',                   meta:'snippet', doc:'Struct'},
            {cap:'enum',      snip:'enum ${1:Name} {\n    ${2:Variant}(${3:Type}),\n    ${4:Other},\n}', meta:'snippet', doc:'Enum'},
            {cap:'impl',      snip:'impl ${1:Name} {\n    fn ${2:new}() -> Self {\n        ${3}\n    }\n}', meta:'snippet', doc:'Impl block'},
            {cap:'trait',     snip:'trait ${1:Name} {\n    fn ${2:method}(&self) -> ${3:type};\n}',       meta:'snippet', doc:'Trait'},
            {cap:'match',     snip:'match ${1:expr} {\n    ${2:Some(x)} => ${3:x},\n    _ => ${4:()},\n}', meta:'snippet', doc:'Match'},
            {cap:'if let',    snip:'if let ${1:Some(x)} = ${2:expr} {\n    ${3}\n}',                     meta:'snippet', doc:'If let'},
            {cap:'while let', snip:'while let ${1:Some(x)} = ${2:iter.next()} {\n    ${3}\n}',           meta:'snippet', doc:'While let'},
            {cap:'for',       snip:'for ${1:item} in ${2:iter} {\n    ${3}\n}',                          meta:'snippet', doc:'For loop'},
            {cap:'use',       snip:'use ${1:std::collections::HashMap};',                                 meta:'snippet', doc:'Use statement'},
            {cap:'#[derive]', snip:'#[derive(${1:Debug, Clone})]',                                       meta:'snippet', doc:'Derive macro'},
            {cap:'println',   snip:'println!("${1}");',                                                   meta:'macro',   doc:'Print with newline'},
            {cap:'format',    snip:'let ${1:s} = format!("${2}", ${3});',                                meta:'macro',   doc:'Format string'},
            {cap:'vec',       snip:'let ${1:v} = vec![${2}];',                                           meta:'macro',   doc:'Vec macro'},
            {cap:'unwrap_or', snip:'${1:opt}.unwrap_or(${2:default})',                                   meta:'method',  doc:'Unwrap with default'},
        ]
    },
    java: {
        keywords: ['abstract','assert','boolean','break','byte','case','catch','char','class',
            'const','continue','default','do','double','else','enum','extends','final',
            'finally','float','for','if','implements','import','instanceof','int','interface',
            'long','new','package','private','protected','public','return','short','static',
            'super','switch','synchronized','this','throw','throws','try','var','void',
            'while','true','false','null'],
        builtins: ['System','String','Integer','Double','Boolean','Long','Float','Character',
            'Math','Arrays','ArrayList','LinkedList','HashMap','HashSet','TreeMap','List',
            'Map','Set','Optional','Stream','Collectors','Objects','Collections',
            'StringBuilder','Thread','Runnable','Exception'],
        snippets: [
            {cap:'main',     snip:'public static void main(String[] args) {\n    ${1}\n}',               meta:'snippet', doc:'Main method'},
            {cap:'class',    snip:'public class ${1:Name} {\n    \n    public ${1:Name}(${2:args}) {\n        ${3}\n    }\n}', meta:'snippet', doc:'Class'},
            {cap:'method',   snip:'public ${1:void} ${2:name}(${3:args}) {\n    ${4}\n}',               meta:'snippet', doc:'Method'},
            {cap:'for',      snip:'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    ${3}\n}',    meta:'snippet', doc:'For loop'},
            {cap:'foreach',  snip:'for (${1:Type} ${2:item} : ${3:collection}) {\n    ${4}\n}',         meta:'snippet', doc:'Enhanced for'},
            {cap:'while',    snip:'while (${1:condition}) {\n    ${2}\n}',                              meta:'snippet', doc:'While loop'},
            {cap:'if',       snip:'if (${1:condition}) {\n    ${2}\n}',                                 meta:'snippet', doc:'If statement'},
            {cap:'try',      snip:'try {\n    ${1}\n} catch (${2:Exception} ${3:e}) {\n    ${3:e}.printStackTrace();\n}', meta:'snippet', doc:'Try-catch'},
            {cap:'interface',snip:'public interface ${1:Name} {\n    ${2:void} ${3:method}(${4:args});\n}', meta:'snippet', doc:'Interface'},
            {cap:'enum',     snip:'public enum ${1:Name} {\n    ${2:VALUE1}, ${3:VALUE2};\n}',          meta:'snippet', doc:'Enum'},
            {cap:'sysout',   snip:'System.out.println(${1});',                                          meta:'method',  doc:'Print to stdout'},
            {cap:'import',   snip:'import ${1:java.util.List};',                                        meta:'snippet', doc:'Import'},
        ]
    },
    ruby: {
        keywords: ['BEGIN','END','alias','and','begin','break','case','class','def','defined?',
            'do','else','elsif','end','ensure','false','for','if','in','module','next','nil',
            'not','or','raise','redo','rescue','retry','return','self','super','then','true',
            'undef','unless','until','when','while','yield'],
        builtins: ['puts','print','p','pp','require','require_relative','attr_accessor',
            'attr_reader','attr_writer','include','extend','raise','lambda','proc',
            'Integer','String','Array','Hash','Float','Symbol','Range','Regexp'],
        snippets: [
            {cap:'def',     snip:'def ${1:name}(${2:args})\n  ${3}\nend',                               meta:'snippet', doc:'Method'},
            {cap:'class',   snip:'class ${1:Name}\n  def initialize(${2:args})\n    ${3}\n  end\nend',  meta:'snippet', doc:'Class'},
            {cap:'module',  snip:'module ${1:Name}\n  ${2}\nend',                                       meta:'snippet', doc:'Module'},
            {cap:'each',    snip:'${1:arr}.each do |${2:item}|\n  ${3}\nend',                           meta:'snippet', doc:'Each loop'},
            {cap:'map',     snip:'${1:arr}.map { |${2:x}| ${3:x} }',                                   meta:'snippet', doc:'Map'},
            {cap:'if',      snip:'if ${1:condition}\n  ${2}\nend',                                      meta:'snippet', doc:'If'},
            {cap:'unless',  snip:'unless ${1:condition}\n  ${2}\nend',                                  meta:'snippet', doc:'Unless'},
            {cap:'begin',   snip:'begin\n  ${1}\nrescue ${2:StandardError} => ${3:e}\n  ${4}\nend',     meta:'snippet', doc:'Begin-rescue'},
            {cap:'puts',    snip:'puts "${1:Hello}"',                                                   meta:'method',  doc:'Print with newline'},
        ]
    },
    shell: {
        keywords: ['if','then','else','elif','fi','case','esac','for','while','do','done',
            'function','return','exit','break','continue','local','export','readonly',
            'source','alias','unset','set'],
        builtins: ['echo','printf','read','cd','ls','pwd','mkdir','rm','cp','mv','cat',
            'grep','sed','awk','cut','sort','uniq','wc','head','tail','find','chmod',
            'chown','kill','ps','curl','wget','tar','zip','unzip','test','true','false'],
        snippets: [
            {cap:'if',      snip:'if [[ ${1:condition} ]]; then\n    ${2}\nfi',                         meta:'snippet', doc:'If statement'},
            {cap:'if else', snip:'if [[ ${1:condition} ]]; then\n    ${2}\nelse\n    ${3}\nfi',         meta:'snippet', doc:'If-else'},
            {cap:'for',     snip:'for ${1:item} in ${2:list}; do\n    ${3}\ndone',                      meta:'snippet', doc:'For loop'},
            {cap:'while',   snip:'while [[ ${1:condition} ]]; do\n    ${2}\ndone',                      meta:'snippet', doc:'While loop'},
            {cap:'function',snip:'${1:name}() {\n    ${2}\n}',                                         meta:'snippet', doc:'Function'},
            {cap:'case',    snip:'case "${1:var}" in\n    ${2:pattern})\n        ${3}\n        ;;\nesac', meta:'snippet', doc:'Case statement'},
            {cap:'shebang', snip:'#!/bin/bash\nset -euo pipefail\n\n${1}',                              meta:'snippet', doc:'Bash shebang'},
            {cap:'echo',    snip:'echo "${1:message}"',                                                 meta:'builtin', doc:'Print text'},
        ]
    },
    php: {
        keywords: ['abstract','and','array','as','break','callable','case','catch','class',
            'clone','const','continue','declare','default','do','echo','else','elseif',
            'empty','extends','final','finally','fn','for','foreach','function','global',
            'if','implements','include','instanceof','interface','match','namespace',
            'new','null','or','private','protected','public','readonly','return','static',
            'switch','throw','trait','true','try','use','var','while','yield'],
        builtins: ['echo','print','var_dump','print_r','isset','empty','unset','count',
            'array_push','array_pop','array_map','array_filter','array_keys','array_values',
            'explode','implode','strlen','strpos','substr','str_replace','trim',
            'strtolower','strtoupper','json_encode','json_decode','date','time',
            'file_get_contents','file_put_contents','preg_match','preg_replace'],
        snippets: [
            {cap:'function',snip:'function ${1:name}(${2:args}): ${3:void} {\n    ${4}\n}',            meta:'snippet', doc:'Function'},
            {cap:'class',   snip:'class ${1:Name} {\n    public function __construct(${2:args}) {\n        ${3}\n    }\n}', meta:'snippet', doc:'Class'},
            {cap:'for',     snip:'for ($${1:i} = 0; $${1:i} < ${2:n}; $${1:i}++) {\n    ${3}\n}',     meta:'snippet', doc:'For loop'},
            {cap:'foreach', snip:'foreach ($${1:arr} as $${2:key} => $${3:val}) {\n    ${4}\n}',       meta:'snippet', doc:'Foreach'},
            {cap:'if',      snip:'if (${1:condition}) {\n    ${2}\n}',                                 meta:'snippet', doc:'If statement'},
            {cap:'try',     snip:'try {\n    ${1}\n} catch (${2:Exception} $${3:e}) {\n    ${4}\n}',  meta:'snippet', doc:'Try-catch'},
            {cap:'echo',    snip:'echo ${1:"Hello"};',                                                 meta:'builtin', doc:'Output text'},
        ]
    },
    c: {
        keywords: ['auto','break','case','char','const','continue','default','do','double',
            'else','enum','extern','float','for','goto','if','inline','int','long',
            'register','return','short','signed','sizeof','static','struct','switch',
            'typedef','union','unsigned','void','volatile','while','NULL'],
        builtins: ['printf','scanf','fprintf','fscanf','fopen','fclose','fgets','fputs',
            'malloc','calloc','realloc','free','strlen','strcpy','strcat','strcmp',
            'strncpy','strncmp','memcpy','memset','memmove','atoi','atof','rand',
            'srand','exit','abort','abs','pow','sqrt','time'],
        snippets: [
            {cap:'main',    snip:'int main(int argc, char *argv[]) {\n    ${1}\n    return 0;\n}',      meta:'snippet', doc:'Main function'},
            {cap:'func',    snip:'${1:void} ${2:name}(${3:args}) {\n    ${4}\n}',                      meta:'snippet', doc:'Function'},
            {cap:'for',     snip:'for (int ${1:i} = 0; ${1:i} < ${2:n}; ${1:i}++) {\n    ${3}\n}',    meta:'snippet', doc:'For loop'},
            {cap:'while',   snip:'while (${1:condition}) {\n    ${2}\n}',                              meta:'snippet', doc:'While loop'},
            {cap:'if',      snip:'if (${1:condition}) {\n    ${2}\n}',                                 meta:'snippet', doc:'If statement'},
            {cap:'struct',  snip:'typedef struct {\n    ${1:type} ${2:field};\n} ${3:Name};',          meta:'snippet', doc:'Struct typedef'},
            {cap:'switch',  snip:'switch (${1:expr}) {\n    case ${2:val}:\n        ${3}\n        break;\n    default:\n        break;\n}', meta:'snippet', doc:'Switch'},
            {cap:'include', snip:'#include <${1:stdio.h}>',                                            meta:'snippet', doc:'Include header'},
            {cap:'define',  snip:'#define ${1:NAME} ${2:value}',                                      meta:'snippet', doc:'Macro define'},
            {cap:'printf',  snip:'printf("${1:%s}\\n", ${2:args});',                                  meta:'function',doc:'Printf'},
            {cap:'malloc',  snip:'${1:type} *${2:ptr} = malloc(${3:n} * sizeof(${1:type}));',         meta:'function',doc:'Allocate memory'},
        ]
    },
    cpp: {
        keywords: ['and','auto','bool','break','case','catch','char','class','const','constexpr',
            'continue','decltype','default','delete','do','double','else','enum','explicit',
            'extern','false','float','for','friend','if','inline','int','long','mutable',
            'namespace','new','noexcept','nullptr','operator','override','private','protected',
            'public','return','short','signed','sizeof','static','struct','switch','template',
            'this','throw','true','try','typedef','typename','union','unsigned','using',
            'virtual','void','volatile','while'],
        builtins: ['std::cout','std::cin','std::cerr','std::endl','std::string','std::vector',
            'std::map','std::unordered_map','std::set','std::pair','std::tuple',
            'std::shared_ptr','std::unique_ptr','std::make_shared','std::make_unique',
            'std::move','std::forward','std::begin','std::end','std::sort','std::find',
            'std::min','std::max','std::swap','std::to_string','std::stoi'],
        snippets: [
            {cap:'main',      snip:'int main() {\n    ${1}\n    return 0;\n}',                          meta:'snippet', doc:'Main function'},
            {cap:'func',      snip:'${1:void} ${2:name}(${3:args}) {\n    ${4}\n}',                    meta:'snippet', doc:'Function'},
            {cap:'class',     snip:'class ${1:Name} {\npublic:\n    ${1:Name}() = default;\n    ~${1:Name}() = default;\n\nprivate:\n    ${2}\n};', meta:'snippet', doc:'Class'},
            {cap:'struct',    snip:'struct ${1:Name} {\n    ${2:type} ${3:field};\n};',                meta:'snippet', doc:'Struct'},
            {cap:'template',  snip:'template<typename ${1:T}>\n${2:void} ${3:name}(${4:args}) {\n    ${5}\n}', meta:'snippet', doc:'Template'},
            {cap:'for',       snip:'for (int ${1:i} = 0; ${1:i} < ${2:n}; ++${1:i}) {\n    ${3}\n}',  meta:'snippet', doc:'For loop'},
            {cap:'rangefor',  snip:'for (const auto& ${1:item} : ${2:container}) {\n    ${3}\n}',      meta:'snippet', doc:'Range-for loop'},
            {cap:'if',        snip:'if (${1:condition}) {\n    ${2}\n}',                               meta:'snippet', doc:'If statement'},
            {cap:'try',       snip:'try {\n    ${1}\n} catch (const ${2:std::exception}& ${3:e}) {\n    std::cerr << ${3:e}.what() << "\\n";\n}', meta:'snippet', doc:'Try-catch'},
            {cap:'cout',      snip:'std::cout << ${1:"Hello"} << std::endl;',                          meta:'snippet', doc:'Print to stdout'},
            {cap:'include',   snip:'#include <${1:iostream}>',                                         meta:'snippet', doc:'Include header'},
            {cap:'vector',    snip:'std::vector<${1:int}> ${2:v};',                                   meta:'snippet', doc:'Vector'},
            {cap:'auto',      snip:'auto ${1:var} = ${2:expr};',                                      meta:'snippet', doc:'Auto variable'},
            {cap:'lambda',    snip:'auto ${1:fn} = [${2:&}](${3:args}) {\n    ${4}\n};',              meta:'snippet', doc:'Lambda'},
        ]
    },
    r: {
        keywords: ['if','else','for','while','repeat','break','next','return','function',
            'in','NULL','NA','TRUE','FALSE','Inf','NaN','NA_integer_','NA_real_',
            'NA_complex_','NA_character_'],
        builtins: ['c','list','data.frame','matrix','array','vector','factor','print','cat',
            'paste','paste0','sprintf','nchar','length','nrow','ncol','dim','names',
            'sum','mean','median','min','max','var','sd','range','which','table',
            'apply','lapply','sapply','tapply','Map','Reduce','Filter',
            'read.csv','write.csv','read.table','ggplot','library','require'],
        snippets: [
            {cap:'function', snip:'${1:name} <- function(${2:args}) {\n  ${3}\n}',                     meta:'snippet', doc:'Function'},
            {cap:'for',      snip:'for (${1:i} in ${2:1:10}) {\n  ${3}\n}',                           meta:'snippet', doc:'For loop'},
            {cap:'if',       snip:'if (${1:condition}) {\n  ${2}\n}',                                  meta:'snippet', doc:'If statement'},
            {cap:'apply',    snip:'${1:sapply}(${2:list}, function(${3:x}) {\n  ${4}\n})',             meta:'snippet', doc:'Apply function'},
            {cap:'ggplot',   snip:'ggplot(${1:data}, aes(x=${2:x}, y=${3:y})) +\n  geom_${4:point}()', meta:'snippet', doc:'GGplot chart'},
            {cap:'cat',      snip:'cat("${1:message}\\n")',                                            meta:'function',doc:'Print text'},
        ]
    },
    sql: {
        keywords: ['SELECT','FROM','WHERE','JOIN','LEFT','RIGHT','INNER','OUTER','ON','AS',
            'AND','OR','NOT','IN','LIKE','BETWEEN','IS','NULL','INSERT','INTO','VALUES',
            'UPDATE','SET','DELETE','CREATE','TABLE','DROP','ALTER','ADD','COLUMN',
            'INDEX','VIEW','PROCEDURE','FUNCTION','TRIGGER','DATABASE','USE','SHOW',
            'DESCRIBE','EXPLAIN','ORDER','BY','GROUP','HAVING','LIMIT','OFFSET',
            'DISTINCT','UNION','ALL','EXISTS','CASE','WHEN','THEN','ELSE','END',
            'BEGIN','COMMIT','ROLLBACK','TRANSACTION'],
        builtins: ['COUNT','SUM','AVG','MIN','MAX','COALESCE','NULLIF','IFNULL','NVL',
            'CONCAT','SUBSTRING','LENGTH','UPPER','LOWER','TRIM','REPLACE','NOW',
            'CURDATE','DATE','YEAR','MONTH','DAY','DATEDIFF','CAST','CONVERT',
            'ROW_NUMBER','RANK','DENSE_RANK','LAG','LEAD','OVER','PARTITION'],
        snippets: [
            {cap:'SELECT',   snip:'SELECT ${1:*}\nFROM ${2:table}\nWHERE ${3:condition};',             meta:'snippet', doc:'Select query'},
            {cap:'JOIN',     snip:'SELECT ${1:*}\nFROM ${2:t1}\nJOIN ${3:t2} ON ${2:t1}.${4:id} = ${3:t2}.${5:id};', meta:'snippet', doc:'Join query'},
            {cap:'INSERT',   snip:'INSERT INTO ${1:table} (${2:cols})\nVALUES (${3:vals});',           meta:'snippet', doc:'Insert row'},
            {cap:'UPDATE',   snip:'UPDATE ${1:table}\nSET ${2:col} = ${3:val}\nWHERE ${4:id} = ${5:1};', meta:'snippet', doc:'Update row'},
            {cap:'DELETE',   snip:'DELETE FROM ${1:table}\nWHERE ${2:id} = ${3:1};',                  meta:'snippet', doc:'Delete row'},
            {cap:'CREATE TABLE',snip:'CREATE TABLE ${1:name} (\n    ${2:id} INT PRIMARY KEY AUTO_INCREMENT,\n    ${3:col} ${4:VARCHAR(255)}\n);', meta:'snippet', doc:'Create table'},
            {cap:'GROUP BY', snip:'SELECT ${1:col}, COUNT(*)\nFROM ${2:table}\nGROUP BY ${1:col}\nHAVING COUNT(*) > ${3:1};', meta:'snippet', doc:'Group by'},
        ]
    },
    html: {
        keywords: [],
        builtins: [],
        snippets: [
            {cap:'html5',    snip:'<!DOCTYPE html>\n<html lang="${1:en}">\n<head>\n    <meta charset="UTF-8">\n    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n    <title>${2:Title}</title>\n</head>\n<body>\n    ${3}\n</body>\n</html>', meta:'snippet', doc:'HTML5 boilerplate'},
            {cap:'div',      snip:'<div class="${1:}">\n    ${2}\n</div>',                             meta:'snippet', doc:'Div element'},
            {cap:'a',        snip:'<a href="${1:#}">${2:Link}</a>',                                    meta:'snippet', doc:'Anchor'},
            {cap:'img',      snip:'<img src="${1:url}" alt="${2:description}">',                       meta:'snippet', doc:'Image'},
            {cap:'form',     snip:'<form action="${1:#}" method="${2:POST}">\n    ${3}\n    <button type="submit">${4:Submit}</button>\n</form>', meta:'snippet', doc:'Form'},
            {cap:'input',    snip:'<input type="${1:text}" name="${2:name}" placeholder="${3:}">',     meta:'snippet', doc:'Input'},
            {cap:'ul',       snip:'<ul>\n    <li>${1:Item}</li>\n</ul>',                              meta:'snippet', doc:'Unordered list'},
            {cap:'table',    snip:'<table>\n    <tr>\n        <th>${1:Header}</th>\n    </tr>\n    <tr>\n        <td>${2:Data}</td>\n    </tr>\n</table>', meta:'snippet', doc:'Table'},
            {cap:'script',   snip:'<script>\n    ${1}\n</script>',                                   meta:'snippet', doc:'Script tag'},
            {cap:'style',    snip:'<style>\n    ${1}\n</style>',                                     meta:'snippet', doc:'Style tag'},
            {cap:'meta',     snip:'<meta name="${1:description}" content="${2:}">',                  meta:'snippet', doc:'Meta tag'},
            {cap:'link css', snip:'<link rel="stylesheet" href="${1:style.css}">',                   meta:'snippet', doc:'CSS link'},
        ]
    },
    css: {
        keywords: ['important','px','em','rem','vh','vw','%','auto','none','block','inline',
            'flex','grid','absolute','relative','fixed','sticky','inherit','initial'],
        builtins: ['color','background','background-color','background-image','border',
            'border-radius','box-shadow','display','flex-direction','align-items',
            'justify-content','gap','grid-template-columns','margin','padding','width',
            'height','min-width','max-width','min-height','max-height','font-size',
            'font-weight','font-family','line-height','text-align','text-decoration',
            'opacity','transform','transition','animation','cursor','overflow','position',
            'top','left','right','bottom','z-index'],
        snippets: [
            {cap:'flex',      snip:'.${1:container} {\n    display: flex;\n    align-items: ${2:center};\n    justify-content: ${3:space-between};\n    gap: ${4:1rem};\n}', meta:'snippet', doc:'Flexbox'},
            {cap:'grid',      snip:'.${1:container} {\n    display: grid;\n    grid-template-columns: ${2:repeat(3, 1fr)};\n    gap: ${3:1rem};\n}', meta:'snippet', doc:'CSS Grid'},
            {cap:'media',     snip:'@media (max-width: ${1:768px}) {\n    ${2}\n}',                   meta:'snippet', doc:'Media query'},
            {cap:'animation', snip:'@keyframes ${1:name} {\n    from { ${2} }\n    to { ${3} }\n}\n\n.${4:element} {\n    animation: ${1:name} ${5:0.3s ease};\n}', meta:'snippet', doc:'Keyframe animation'},
            {cap:'var',       snip:':root {\n    --${1:name}: ${2:value};\n}',                        meta:'snippet', doc:'CSS variable'},
            {cap:'transition',snip:'transition: ${1:all} ${2:0.3s} ${3:ease};',                       meta:'snippet', doc:'Transition'},
            {cap:'transform', snip:'transform: ${1:translateX(0)};',                                  meta:'snippet', doc:'Transform'},
            {cap:'shadow',    snip:'box-shadow: ${1:0 4px 6px} rgba(${2:0,0,0,0.1});',               meta:'snippet', doc:'Box shadow'},
        ]
    },
};

// ── Module / object member completions (dot completions) ─────────
// Each key is what the user typed before the dot (module name or alias).
// Members: { name, snip?, value?, meta, doc }
//   snip  = snippet with tab-stops (replaces what's after the dot)
//   value = plain text insertion when no args needed
const MODULE_COMPLETIONS = {
    // ── Python ──────────────────────────────────────────────────────
    python: {
        // Standard library
        math: [
            {name:'sqrt',     snip:'sqrt(${1:x})',              meta:'function', doc:'Square root of x'},
            {name:'pi',       value:'pi',                       meta:'constant', doc:'π ≈ 3.14159265…'},
            {name:'e',        value:'e',                        meta:'constant', doc:"Euler's number ≈ 2.71828…"},
            {name:'tau',      value:'tau',                      meta:'constant', doc:'2π ≈ 6.28318…'},
            {name:'inf',      value:'inf',                      meta:'constant', doc:'Floating-point infinity'},
            {name:'nan',      value:'nan',                      meta:'constant', doc:'Not a Number'},
            {name:'ceil',     snip:'ceil(${1:x})',              meta:'function', doc:'Smallest integer ≥ x'},
            {name:'floor',    snip:'floor(${1:x})',             meta:'function', doc:'Largest integer ≤ x'},
            {name:'trunc',    snip:'trunc(${1:x})',             meta:'function', doc:'Truncate to integer'},
            {name:'round',    snip:'round(${1:x}, ${2:n})',     meta:'function', doc:'Round to n decimal places'},
            {name:'abs',      snip:'abs(${1:x})',               meta:'function', doc:'Absolute value'},
            {name:'fabs',     snip:'fabs(${1:x})',              meta:'function', doc:'Absolute value as float'},
            {name:'factorial',snip:'factorial(${1:n})',         meta:'function', doc:'n!'},
            {name:'gcd',      snip:'gcd(${1:a}, ${2:b})',       meta:'function', doc:'Greatest common divisor'},
            {name:'lcm',      snip:'lcm(${1:a}, ${2:b})',       meta:'function', doc:'Least common multiple'},
            {name:'pow',      snip:'pow(${1:x}, ${2:y})',       meta:'function', doc:'x raised to power y'},
            {name:'exp',      snip:'exp(${1:x})',               meta:'function', doc:'e raised to power x'},
            {name:'log',      snip:'log(${1:x})',               meta:'function', doc:'Natural logarithm of x'},
            {name:'log2',     snip:'log2(${1:x})',              meta:'function', doc:'Base-2 logarithm'},
            {name:'log10',    snip:'log10(${1:x})',             meta:'function', doc:'Base-10 logarithm'},
            {name:'sin',      snip:'sin(${1:x})',               meta:'function', doc:'Sine of x (radians)'},
            {name:'cos',      snip:'cos(${1:x})',               meta:'function', doc:'Cosine of x (radians)'},
            {name:'tan',      snip:'tan(${1:x})',               meta:'function', doc:'Tangent of x (radians)'},
            {name:'asin',     snip:'asin(${1:x})',              meta:'function', doc:'Arc sine'},
            {name:'acos',     snip:'acos(${1:x})',              meta:'function', doc:'Arc cosine'},
            {name:'atan',     snip:'atan(${1:x})',              meta:'function', doc:'Arc tangent'},
            {name:'atan2',    snip:'atan2(${1:y}, ${2:x})',     meta:'function', doc:'Arc tangent of y/x'},
            {name:'degrees',  snip:'degrees(${1:x})',           meta:'function', doc:'Radians → degrees'},
            {name:'radians',  snip:'radians(${1:x})',           meta:'function', doc:'Degrees → radians'},
            {name:'hypot',    snip:'hypot(${1:x}, ${2:y})',     meta:'function', doc:'Euclidean distance'},
            {name:'isnan',    snip:'isnan(${1:x})',             meta:'function', doc:'True if x is NaN'},
            {name:'isinf',    snip:'isinf(${1:x})',             meta:'function', doc:'True if x is infinite'},
            {name:'isfinite', snip:'isfinite(${1:x})',          meta:'function', doc:'True if x is finite'},
            {name:'comb',     snip:'comb(${1:n}, ${2:k})',      meta:'function', doc:'n choose k'},
            {name:'perm',     snip:'perm(${1:n}, ${2:k})',      meta:'function', doc:'Permutations P(n,k)'},
        ],
        os: [
            {name:'getcwd',   snip:'getcwd()',                  meta:'function', doc:'Current working directory'},
            {name:'chdir',    snip:'chdir(${1:path})',          meta:'function', doc:'Change directory'},
            {name:'listdir',  snip:'listdir(${1:"."})',         meta:'function', doc:'List directory contents'},
            {name:'mkdir',    snip:'mkdir(${1:path})',          meta:'function', doc:'Create directory'},
            {name:'makedirs', snip:'makedirs(${1:path}, exist_ok=${2:True})', meta:'function', doc:'Create directories recursively'},
            {name:'remove',   snip:'remove(${1:path})',         meta:'function', doc:'Delete a file'},
            {name:'rmdir',    snip:'rmdir(${1:path})',          meta:'function', doc:'Remove empty directory'},
            {name:'rename',   snip:'rename(${1:src}, ${2:dst})',meta:'function', doc:'Rename file or directory'},
            {name:'walk',     snip:'walk(${1:top})',            meta:'function', doc:'Walk directory tree'},
            {name:'getenv',   snip:'getenv(${1:"KEY"}, ${2:None})', meta:'function', doc:'Get environment variable'},
            {name:'environ',  value:'environ',                  meta:'variable', doc:'Environment variables dict'},
            {name:'path',     value:'path',                     meta:'module',   doc:'os.path submodule'},
            {name:'sep',      value:'sep',                      meta:'constant', doc:'Path separator (/ or \\)'},
            {name:'linesep',  value:'linesep',                  meta:'constant', doc:'Line separator'},
            {name:'devnull',  value:'devnull',                  meta:'constant', doc:'Null device path'},
            {name:'stat',     snip:'stat(${1:path})',           meta:'function', doc:'File status'},
            {name:'getpid',   snip:'getpid()',                  meta:'function', doc:'Current process ID'},
        ],
        path: [
            {name:'join',     snip:'join(${1:path}, ${2:*paths})',   meta:'function', doc:'Join path components'},
            {name:'exists',   snip:'exists(${1:path})',              meta:'function', doc:'True if path exists'},
            {name:'isfile',   snip:'isfile(${1:path})',              meta:'function', doc:'True if path is a file'},
            {name:'isdir',    snip:'isdir(${1:path})',               meta:'function', doc:'True if path is a directory'},
            {name:'dirname',  snip:'dirname(${1:path})',             meta:'function', doc:'Directory part of path'},
            {name:'basename', snip:'basename(${1:path})',            meta:'function', doc:'Final component of path'},
            {name:'abspath',  snip:'abspath(${1:path})',             meta:'function', doc:'Absolute path'},
            {name:'split',    snip:'split(${1:path})',               meta:'function', doc:'Split into (head, tail)'},
            {name:'splitext', snip:'splitext(${1:path})',            meta:'function', doc:'Split off extension'},
            {name:'expanduser',snip:'expanduser(${1:"~"})',          meta:'function', doc:'Expand ~ to home dir'},
            {name:'realpath', snip:'realpath(${1:path})',            meta:'function', doc:'Canonical absolute path'},
        ],
        sys: [
            {name:'argv',     value:'argv',                     meta:'variable', doc:'Command-line arguments list'},
            {name:'exit',     snip:'exit(${1:0})',              meta:'function', doc:'Exit interpreter'},
            {name:'path',     value:'path',                     meta:'variable', doc:'Module search path list'},
            {name:'stdin',    value:'stdin',                    meta:'variable', doc:'Standard input stream'},
            {name:'stdout',   value:'stdout',                   meta:'variable', doc:'Standard output stream'},
            {name:'stderr',   value:'stderr',                   meta:'variable', doc:'Standard error stream'},
            {name:'version',  value:'version',                  meta:'variable', doc:'Python version string'},
            {name:'platform', value:'platform',                 meta:'variable', doc:'Platform identifier'},
            {name:'modules',  value:'modules',                  meta:'variable', doc:'Imported modules dict'},
            {name:'getrecursionlimit', snip:'getrecursionlimit()', meta:'function', doc:'Current recursion limit'},
            {name:'setrecursionlimit', snip:'setrecursionlimit(${1:1000})', meta:'function', doc:'Set recursion limit'},
            {name:'exc_info', snip:'exc_info()',                meta:'function', doc:'Current exception info'},
        ],
        json: [
            {name:'dumps',    snip:'dumps(${1:obj}, indent=${2:2})',          meta:'function', doc:'Serialize obj to JSON string'},
            {name:'loads',    snip:'loads(${1:s})',                           meta:'function', doc:'Deserialize JSON string'},
            {name:'dump',     snip:'dump(${1:obj}, ${2:fp}, indent=${3:2})', meta:'function', doc:'Serialize obj to file'},
            {name:'load',     snip:'load(${1:fp})',                          meta:'function', doc:'Deserialize from file'},
        ],
        re: [
            {name:'match',    snip:'match(${1:pattern}, ${2:string})',          meta:'function', doc:'Match at beginning of string'},
            {name:'search',   snip:'search(${1:pattern}, ${2:string})',         meta:'function', doc:'Search anywhere in string'},
            {name:'findall',  snip:'findall(${1:pattern}, ${2:string})',        meta:'function', doc:'Find all non-overlapping matches'},
            {name:'finditer', snip:'finditer(${1:pattern}, ${2:string})',       meta:'function', doc:'Iterator over all matches'},
            {name:'sub',      snip:'sub(${1:pattern}, ${2:repl}, ${3:string})', meta:'function', doc:'Replace matches with repl'},
            {name:'split',    snip:'split(${1:pattern}, ${2:string})',          meta:'function', doc:'Split by pattern'},
            {name:'compile',  snip:'compile(${1:pattern})',                     meta:'function', doc:'Compile pattern to regex object'},
            {name:'fullmatch',snip:'fullmatch(${1:pattern}, ${2:string})',      meta:'function', doc:'Match entire string'},
            {name:'escape',   snip:'escape(${1:string})',                       meta:'function', doc:'Escape special characters'},
            {name:'IGNORECASE',value:'IGNORECASE',                              meta:'flag',     doc:'Case-insensitive matching'},
            {name:'MULTILINE', value:'MULTILINE',                               meta:'flag',     doc:'^ and $ match each line'},
            {name:'DOTALL',    value:'DOTALL',                                  meta:'flag',     doc:'. matches newlines too'},
        ],
        random: [
            {name:'random',   snip:'random()',                        meta:'function', doc:'Random float in [0.0, 1.0)'},
            {name:'randint',  snip:'randint(${1:a}, ${2:b})',         meta:'function', doc:'Random int in [a, b]'},
            {name:'choice',   snip:'choice(${1:seq})',                meta:'function', doc:'Random element from sequence'},
            {name:'choices',  snip:'choices(${1:population}, k=${2:1})', meta:'function', doc:'k random elements with replacement'},
            {name:'sample',   snip:'sample(${1:population}, ${2:k})', meta:'function', doc:'k unique random elements'},
            {name:'shuffle',  snip:'shuffle(${1:list})',              meta:'function', doc:'Shuffle list in place'},
            {name:'uniform',  snip:'uniform(${1:a}, ${2:b})',         meta:'function', doc:'Random float in [a, b]'},
            {name:'gauss',    snip:'gauss(${1:mu}, ${2:sigma})',      meta:'function', doc:'Gaussian distribution'},
            {name:'seed',     snip:'seed(${1:a})',                    meta:'function', doc:'Set random seed'},
            {name:'randrange',snip:'randrange(${1:start}, ${2:stop})', meta:'function', doc:'Random int from range'},
        ],
        datetime: [
            {name:'datetime', snip:'datetime(${1:year}, ${2:month}, ${3:day})', meta:'class',   doc:'Date + time object'},
            {name:'date',     snip:'date(${1:year}, ${2:month}, ${3:day})',     meta:'class',   doc:'Date object'},
            {name:'time',     snip:'time(${1:hour}, ${2:minute}, ${3:second})', meta:'class',   doc:'Time object'},
            {name:'timedelta',snip:'timedelta(${1:days}=${2:0})',               meta:'class',   doc:'Duration or difference'},
            {name:'timezone', value:'timezone',                                  meta:'class',   doc:'Timezone info'},
            {name:'now',      snip:'now()',                                      meta:'function', doc:'Current local datetime'},
            {name:'today',    snip:'today()',                                    meta:'function', doc:"Today's date"},
            {name:'fromisoformat', snip:'fromisoformat(${1:"2024-01-01"})',     meta:'function', doc:'Parse ISO format string'},
        ],
        collections: [
            {name:'defaultdict', snip:'defaultdict(${1:list})',                meta:'class',   doc:'Dict with default factory'},
            {name:'OrderedDict', snip:'OrderedDict()',                         meta:'class',   doc:'Dict that remembers insertion order'},
            {name:'Counter',     snip:'Counter(${1:iterable})',                meta:'class',   doc:'Count hashable objects'},
            {name:'deque',       snip:'deque(${1:iterable}, maxlen=${2:None})',meta:'class',   doc:'Double-ended queue'},
            {name:'namedtuple',  snip:'namedtuple("${1:Name}", ["${2:field}"])',meta:'function',doc:'Tuple subclass with named fields'},
            {name:'ChainMap',    snip:'ChainMap(${1:*maps})',                  meta:'class',   doc:'Group multiple dicts'},
        ],
        itertools: [
            {name:'chain',       snip:'chain(${1:*iterables})',              meta:'function', doc:'Chain iterables'},
            {name:'product',     snip:'product(${1:*iterables})',            meta:'function', doc:'Cartesian product'},
            {name:'permutations',snip:'permutations(${1:iterable}, ${2:r})',meta:'function', doc:'Permutations'},
            {name:'combinations',snip:'combinations(${1:iterable}, ${2:r})',meta:'function', doc:'Combinations'},
            {name:'groupby',     snip:'groupby(${1:iterable}, key=${2:None})',meta:'function',doc:'Group consecutive elements'},
            {name:'islice',      snip:'islice(${1:iterable}, ${2:stop})',    meta:'function', doc:'Slice iterator'},
            {name:'cycle',       snip:'cycle(${1:iterable})',                meta:'function', doc:'Cycle infinitely'},
            {name:'repeat',      snip:'repeat(${1:obj}, ${2:times})',        meta:'function', doc:'Repeat element'},
            {name:'count',       snip:'count(${1:start}, ${2:step})',        meta:'function', doc:'Count from start'},
            {name:'accumulate',  snip:'accumulate(${1:iterable})',           meta:'function', doc:'Running totals'},
            {name:'zip_longest', snip:'zip_longest(${1:*iterables})',        meta:'function', doc:'Zip, filling missing values'},
        ],
        functools: [
            {name:'reduce',       snip:'reduce(${1:func}, ${2:iterable})',   meta:'function', doc:'Reduce iterable to single value'},
            {name:'partial',      snip:'partial(${1:func}, ${2:args})',      meta:'function', doc:'Partial function application'},
            {name:'wraps',        snip:'wraps(${1:wrapped})',                meta:'decorator',doc:'Update wrapper function attributes'},
            {name:'lru_cache',    snip:'lru_cache(maxsize=${1:128})',        meta:'decorator',doc:'LRU cache decorator'},
            {name:'cache',        snip:'cache',                              meta:'decorator',doc:'Unbounded cache decorator'},
            {name:'total_ordering',value:'total_ordering',                  meta:'decorator',doc:'Fill in comparison methods'},
        ],
        // numpy (imported as np)
        np: [
            {name:'array',       snip:'array(${1:object})',                  meta:'function', doc:'Create ndarray from data'},
            {name:'zeros',       snip:'zeros(${1:shape})',                   meta:'function', doc:'Array of zeros'},
            {name:'ones',        snip:'ones(${1:shape})',                    meta:'function', doc:'Array of ones'},
            {name:'empty',       snip:'empty(${1:shape})',                   meta:'function', doc:'Uninitialised array'},
            {name:'arange',      snip:'arange(${1:start}, ${2:stop}, ${3:step})', meta:'function', doc:'Evenly spaced values'},
            {name:'linspace',    snip:'linspace(${1:start}, ${2:stop}, ${3:num})', meta:'function', doc:'n evenly spaced values'},
            {name:'eye',         snip:'eye(${1:n})',                         meta:'function', doc:'Identity matrix'},
            {name:'diag',        snip:'diag(${1:v})',                        meta:'function', doc:'Diagonal matrix'},
            {name:'reshape',     snip:'reshape(${1:a}, ${2:shape})',         meta:'function', doc:'Reshape array'},
            {name:'transpose',   snip:'transpose(${1:a})',                   meta:'function', doc:'Transpose array'},
            {name:'dot',         snip:'dot(${1:a}, ${2:b})',                 meta:'function', doc:'Dot product'},
            {name:'sum',         snip:'sum(${1:a}, axis=${2:None})',         meta:'function', doc:'Sum of elements'},
            {name:'mean',        snip:'mean(${1:a}, axis=${2:None})',        meta:'function', doc:'Arithmetic mean'},
            {name:'std',         snip:'std(${1:a}, axis=${2:None})',         meta:'function', doc:'Standard deviation'},
            {name:'var',         snip:'var(${1:a}, axis=${2:None})',         meta:'function', doc:'Variance'},
            {name:'min',         snip:'min(${1:a}, axis=${2:None})',         meta:'function', doc:'Minimum value'},
            {name:'max',         snip:'max(${1:a}, axis=${2:None})',         meta:'function', doc:'Maximum value'},
            {name:'argmin',      snip:'argmin(${1:a}, axis=${2:None})',      meta:'function', doc:'Index of minimum'},
            {name:'argmax',      snip:'argmax(${1:a}, axis=${2:None})',      meta:'function', doc:'Index of maximum'},
            {name:'where',       snip:'where(${1:condition}, ${2:x}, ${3:y})', meta:'function', doc:'Conditional elements'},
            {name:'concatenate', snip:'concatenate((${1:a}, ${2:b}), axis=${3:0})', meta:'function', doc:'Join arrays'},
            {name:'vstack',      snip:'vstack((${1:a}, ${2:b}))',            meta:'function', doc:'Stack vertically'},
            {name:'hstack',      snip:'hstack((${1:a}, ${2:b}))',            meta:'function', doc:'Stack horizontally'},
            {name:'sort',        snip:'sort(${1:a}, axis=${2:-1})',          meta:'function', doc:'Sort array'},
            {name:'unique',      snip:'unique(${1:ar})',                     meta:'function', doc:'Unique elements'},
            {name:'flatten',     snip:'flatten()',                           meta:'method',   doc:'Return flattened copy'},
            {name:'sqrt',        snip:'sqrt(${1:x})',                        meta:'function', doc:'Element-wise square root'},
            {name:'abs',         snip:'abs(${1:x})',                         meta:'function', doc:'Element-wise absolute value'},
            {name:'exp',         snip:'exp(${1:x})',                         meta:'function', doc:'Element-wise e^x'},
            {name:'log',         snip:'log(${1:x})',                         meta:'function', doc:'Element-wise natural log'},
            {name:'pi',          value:'pi',                                  meta:'constant', doc:'π ≈ 3.14159…'},
            {name:'inf',         value:'inf',                                 meta:'constant', doc:'Infinity'},
            {name:'nan',         value:'nan',                                 meta:'constant', doc:'Not a Number'},
            {name:'random',      value:'random',                              meta:'module',   doc:'Random submodule'},
            {name:'linalg',      value:'linalg',                              meta:'module',   doc:'Linear algebra submodule'},
            {name:'dtype',       snip:'dtype(${1:float64})',                 meta:'function', doc:'Data type object'},
        ],
        // pandas (imported as pd)
        pd: [
            {name:'DataFrame',   snip:'DataFrame(${1:data})',                meta:'class',   doc:'2D labelled data structure'},
            {name:'Series',      snip:'Series(${1:data}, name="${2:}")',      meta:'class',   doc:'1D labelled array'},
            {name:'read_csv',    snip:'read_csv("${1:file.csv}")',            meta:'function', doc:'Read CSV into DataFrame'},
            {name:'read_excel',  snip:'read_excel("${1:file.xlsx}")',         meta:'function', doc:'Read Excel into DataFrame'},
            {name:'read_json',   snip:'read_json("${1:file.json}")',          meta:'function', doc:'Read JSON into DataFrame'},
            {name:'read_sql',    snip:'read_sql(${1:sql}, ${2:con})',         meta:'function', doc:'Read SQL query into DataFrame'},
            {name:'concat',      snip:'concat([${1:df1}, ${2:df2}], axis=${3:0})', meta:'function', doc:'Concatenate DataFrames'},
            {name:'merge',       snip:'merge(${1:left}, ${2:right}, on="${3:key}")', meta:'function', doc:'Merge DataFrames'},
            {name:'isna',        snip:'isna(${1:obj})',                       meta:'function', doc:'Detect missing values'},
            {name:'notna',       snip:'notna(${1:obj})',                      meta:'function', doc:'Detect non-missing values'},
            {name:'get_dummies', snip:'get_dummies(${1:data})',               meta:'function', doc:'One-hot encode categorical data'},
            {name:'to_datetime', snip:'to_datetime(${1:arg})',                meta:'function', doc:'Convert to datetime'},
            {name:'date_range',  snip:'date_range("${1:start}", periods=${2:n})', meta:'function', doc:'Fixed-frequency DatetimeIndex'},
        ],
        // matplotlib.pyplot (imported as plt)
        plt: [
            {name:'plot',        snip:'plot(${1:x}, ${2:y}, ${3:"b-"})',     meta:'function', doc:'Plot y vs x'},
            {name:'scatter',     snip:'scatter(${1:x}, ${2:y})',             meta:'function', doc:'Scatter plot'},
            {name:'bar',         snip:'bar(${1:x}, ${2:height})',            meta:'function', doc:'Bar chart'},
            {name:'hist',        snip:'hist(${1:x}, bins=${2:10})',          meta:'function', doc:'Histogram'},
            {name:'imshow',      snip:'imshow(${1:X})',                      meta:'function', doc:'Show image'},
            {name:'show',        snip:'show()',                              meta:'function', doc:'Display all open figures'},
            {name:'figure',      snip:'figure(figsize=(${1:8}, ${2:6}))',    meta:'function', doc:'Create new figure'},
            {name:'subplot',     snip:'subplot(${1:rows}, ${2:cols}, ${3:index})', meta:'function', doc:'Create subplot'},
            {name:'subplots',    snip:'subplots(${1:nrows}, ${2:ncols}, figsize=(${3:10}, ${4:6}))', meta:'function', doc:'Create figure with subplots'},
            {name:'title',       snip:'title("${1:Title}")',                 meta:'function', doc:'Set plot title'},
            {name:'xlabel',      snip:'xlabel("${1:x label}")',              meta:'function', doc:'Set x-axis label'},
            {name:'ylabel',      snip:'ylabel("${1:y label}")',              meta:'function', doc:'Set y-axis label'},
            {name:'legend',      snip:'legend()',                            meta:'function', doc:'Place legend'},
            {name:'grid',        snip:'grid(${1:True})',                     meta:'function', doc:'Show grid'},
            {name:'xlim',        snip:'xlim(${1:xmin}, ${2:xmax})',         meta:'function', doc:'Set x-axis limits'},
            {name:'ylim',        snip:'ylim(${1:ymin}, ${2:ymax})',         meta:'function', doc:'Set y-axis limits'},
            {name:'savefig',     snip:'savefig("${1:figure.png}", dpi=${2:150})', meta:'function', doc:'Save figure to file'},
            {name:'tight_layout',snip:'tight_layout()',                     meta:'function', doc:'Adjust subplot spacing'},
            {name:'clf',         snip:'clf()',                              meta:'function', doc:'Clear current figure'},
            {name:'close',       snip:'close()',                            meta:'function', doc:'Close figure window'},
            {name:'axhline',     snip:'axhline(y=${1:0}, color="${2:r}")',  meta:'function', doc:'Horizontal line'},
            {name:'axvline',     snip:'axvline(x=${1:0}, color="${2:r}")',  meta:'function', doc:'Vertical line'},
        ],
        // requests
        requests: [
            {name:'get',         snip:'get("${1:url}", params=${2:None})',   meta:'function', doc:'GET request'},
            {name:'post',        snip:'post("${1:url}", json=${2:data})',     meta:'function', doc:'POST request'},
            {name:'put',         snip:'put("${1:url}", json=${2:data})',      meta:'function', doc:'PUT request'},
            {name:'delete',      snip:'delete("${1:url}")',                  meta:'function', doc:'DELETE request'},
            {name:'Session',     snip:'Session()',                           meta:'class',    doc:'Persistent session'},
        ],
        // sklearn (imported as various names)
        sklearn: [
            {name:'train_test_split', snip:'train_test_split(${1:X}, ${2:y}, test_size=${3:0.2})', meta:'function', doc:'Split dataset'},
        ],
    },

    // ── JavaScript / TypeScript ──────────────────────────────────────
    javascript: {
        Math: [
            {name:'abs',      snip:'abs(${1:x})',              meta:'function', doc:'Absolute value'},
            {name:'ceil',     snip:'ceil(${1:x})',             meta:'function', doc:'Smallest integer ≥ x'},
            {name:'floor',    snip:'floor(${1:x})',            meta:'function', doc:'Largest integer ≤ x'},
            {name:'round',    snip:'round(${1:x})',            meta:'function', doc:'Round to nearest integer'},
            {name:'trunc',    snip:'trunc(${1:x})',            meta:'function', doc:'Integer part of x'},
            {name:'sqrt',     snip:'sqrt(${1:x})',             meta:'function', doc:'Square root'},
            {name:'cbrt',     snip:'cbrt(${1:x})',             meta:'function', doc:'Cube root'},
            {name:'pow',      snip:'pow(${1:base}, ${2:exp})', meta:'function', doc:'base^exp'},
            {name:'min',      snip:'min(${1:...values})',      meta:'function', doc:'Smallest of values'},
            {name:'max',      snip:'max(${1:...values})',      meta:'function', doc:'Largest of values'},
            {name:'random',   snip:'random()',                 meta:'function', doc:'Random float in [0, 1)'},
            {name:'log',      snip:'log(${1:x})',              meta:'function', doc:'Natural logarithm'},
            {name:'log2',     snip:'log2(${1:x})',             meta:'function', doc:'Base-2 logarithm'},
            {name:'log10',    snip:'log10(${1:x})',            meta:'function', doc:'Base-10 logarithm'},
            {name:'sin',      snip:'sin(${1:x})',              meta:'function', doc:'Sine (radians)'},
            {name:'cos',      snip:'cos(${1:x})',              meta:'function', doc:'Cosine (radians)'},
            {name:'tan',      snip:'tan(${1:x})',              meta:'function', doc:'Tangent (radians)'},
            {name:'asin',     snip:'asin(${1:x})',             meta:'function', doc:'Arc sine'},
            {name:'acos',     snip:'acos(${1:x})',             meta:'function', doc:'Arc cosine'},
            {name:'atan',     snip:'atan(${1:x})',             meta:'function', doc:'Arc tangent'},
            {name:'atan2',    snip:'atan2(${1:y}, ${2:x})',   meta:'function', doc:'Arc tangent of y/x'},
            {name:'sign',     snip:'sign(${1:x})',             meta:'function', doc:'-1, 0, or 1'},
            {name:'hypot',    snip:'hypot(${1:...values})',   meta:'function', doc:'Euclidean norm'},
            {name:'clamp',    snip:'max(${1:min}, Math.min(${2:max}, ${3:x}))', meta:'snippet', doc:'Clamp value (no native)'},
            {name:'PI',       value:'PI',                      meta:'constant', doc:'π ≈ 3.14159…'},
            {name:'E',        value:'E',                       meta:'constant', doc:"Euler's number ≈ 2.71828"},
            {name:'SQRT2',    value:'SQRT2',                   meta:'constant', doc:'√2 ≈ 1.41421'},
            {name:'LN2',      value:'LN2',                     meta:'constant', doc:'Natural log of 2'},
            {name:'LN10',     value:'LN10',                    meta:'constant', doc:'Natural log of 10'},
        ],
        JSON: [
            {name:'parse',     snip:'parse(${1:text})',                       meta:'function', doc:'Parse JSON string → value'},
            {name:'stringify', snip:'stringify(${1:value}, null, ${2:2})',   meta:'function', doc:'Value → JSON string'},
        ],
        console: [
            {name:'log',     snip:'log(${1})',          meta:'method', doc:'Log to console'},
            {name:'error',   snip:'error(${1})',        meta:'method', doc:'Log error'},
            {name:'warn',    snip:'warn(${1})',         meta:'method', doc:'Log warning'},
            {name:'info',    snip:'info(${1})',         meta:'method', doc:'Log info'},
            {name:'debug',   snip:'debug(${1})',        meta:'method', doc:'Log debug'},
            {name:'table',   snip:'table(${1})',        meta:'method', doc:'Display data as table'},
            {name:'time',    snip:'time("${1:label}")', meta:'method', doc:'Start timer'},
            {name:'timeEnd', snip:'timeEnd("${1:label}")', meta:'method', doc:'Stop timer, print elapsed'},
            {name:'group',   snip:'group("${1:label}")',meta:'method', doc:'Start collapsed group'},
            {name:'groupEnd',snip:'groupEnd()',         meta:'method', doc:'End group'},
            {name:'clear',   snip:'clear()',            meta:'method', doc:'Clear console'},
            {name:'assert',  snip:'assert(${1:cond}, "${2:msg}")', meta:'method', doc:'Assert condition'},
            {name:'count',   snip:'count("${1:label}")',meta:'method', doc:'Count calls'},
            {name:'dir',     snip:'dir(${1:obj})',      meta:'method', doc:'Display object properties'},
        ],
        Object: [
            {name:'keys',          snip:'keys(${1:obj})',                           meta:'function', doc:'Array of own enumerable keys'},
            {name:'values',        snip:'values(${1:obj})',                         meta:'function', doc:'Array of own enumerable values'},
            {name:'entries',       snip:'entries(${1:obj})',                        meta:'function', doc:'Array of [key,value] pairs'},
            {name:'assign',        snip:'assign(${1:target}, ${2:source})',         meta:'function', doc:'Copy properties to target'},
            {name:'create',        snip:'create(${1:proto})',                       meta:'function', doc:'Create with given prototype'},
            {name:'freeze',        snip:'freeze(${1:obj})',                         meta:'function', doc:'Make object immutable'},
            {name:'fromEntries',   snip:'fromEntries(${1:entries})',                meta:'function', doc:'Create object from entries'},
            {name:'hasOwn',        snip:'hasOwn(${1:obj}, "${2:key}")',             meta:'function', doc:'Own property check'},
            {name:'defineProperty',snip:'defineProperty(${1:obj}, "${2:key}", { ${3} })', meta:'function', doc:'Define property with descriptor'},
            {name:'getPrototypeOf',snip:'getPrototypeOf(${1:obj})',                meta:'function', doc:'Get prototype'},
            {name:'spread',        snip:'{ ...${1:obj}, ${2:key}: ${3:value} }',   meta:'snippet',  doc:'Spread merge objects'},
        ],
        Array: [
            {name:'from',       snip:'from(${1:iterable})',               meta:'function', doc:'Create array from iterable'},
            {name:'isArray',    snip:'isArray(${1:value})',               meta:'function', doc:'Check if value is array'},
            {name:'of',         snip:'of(${1:...items})',                 meta:'function', doc:'Create array from args'},
        ],
        Promise: [
            {name:'all',        snip:'all([${1:...promises}])',           meta:'function', doc:'Resolve when all settle'},
            {name:'allSettled', snip:'allSettled([${1:...promises}])',    meta:'function', doc:'Resolve when all complete'},
            {name:'any',        snip:'any([${1:...promises}])',           meta:'function', doc:'Resolve when first resolves'},
            {name:'race',       snip:'race([${1:...promises}])',          meta:'function', doc:'Resolve when first settles'},
            {name:'resolve',    snip:'resolve(${1:value})',               meta:'function', doc:'Resolved promise'},
            {name:'reject',     snip:'reject(${1:reason})',               meta:'function', doc:'Rejected promise'},
        ],
        document: [
            {name:'getElementById',    snip:'getElementById("${1:id}")',                   meta:'method', doc:'Find element by ID'},
            {name:'querySelector',     snip:'querySelector("${1:selector}")',               meta:'method', doc:'First matching element'},
            {name:'querySelectorAll',  snip:'querySelectorAll("${1:selector}")',            meta:'method', doc:'All matching elements'},
            {name:'createElement',     snip:'createElement("${1:tag}")',                    meta:'method', doc:'Create HTML element'},
            {name:'createTextNode',    snip:'createTextNode("${1:text}")',                  meta:'method', doc:'Create text node'},
            {name:'addEventListener',  snip:'addEventListener("${1:event}", ${2:handler})',meta:'method', doc:'Add event listener'},
            {name:'body',              value:'body',                                         meta:'property',doc:'document.body element'},
            {name:'head',              value:'head',                                         meta:'property',doc:'document.head element'},
            {name:'title',             value:'title',                                        meta:'property',doc:'Document title'},
            {name:'cookie',            value:'cookie',                                       meta:'property',doc:'Document cookies'},
            {name:'location',          value:'location',                                     meta:'property',doc:'Current URL info'},
        ],
        localStorage: [
            {name:'setItem',    snip:'setItem("${1:key}", ${2:value})',   meta:'method', doc:'Store key-value pair'},
            {name:'getItem',    snip:'getItem("${1:key}")',               meta:'method', doc:'Get stored value'},
            {name:'removeItem', snip:'removeItem("${1:key}")',            meta:'method', doc:'Remove stored key'},
            {name:'clear',      snip:'clear()',                           meta:'method', doc:'Remove all items'},
            {name:'key',        snip:'key(${1:index})',                   meta:'method', doc:'Key at given index'},
            {name:'length',     value:'length',                           meta:'property',doc:'Number of stored items'},
        ],
        window: [
            {name:'alert',              snip:'alert("${1:message}")',          meta:'method',  doc:'Show alert dialog'},
            {name:'confirm',            snip:'confirm("${1:message}")',         meta:'method',  doc:'Show confirm dialog'},
            {name:'prompt',             snip:'prompt("${1:message}")',          meta:'method',  doc:'Show prompt dialog'},
            {name:'setTimeout',         snip:'setTimeout(() => {\n    ${1}\n}, ${2:1000})', meta:'method', doc:'Run after delay'},
            {name:'setInterval',        snip:'setInterval(() => {\n    ${1}\n}, ${2:1000})', meta:'method', doc:'Run repeatedly'},
            {name:'clearTimeout',       snip:'clearTimeout(${1:id})',          meta:'method',  doc:'Cancel timeout'},
            {name:'clearInterval',      snip:'clearInterval(${1:id})',         meta:'method',  doc:'Cancel interval'},
            {name:'requestAnimationFrame', snip:'requestAnimationFrame(${1:callback})', meta:'method', doc:'Next paint callback'},
            {name:'open',               snip:'open("${1:url}", "${2:_blank}")',meta:'method',  doc:'Open new tab/window'},
            {name:'innerWidth',         value:'innerWidth',                    meta:'property',doc:'Viewport width'},
            {name:'innerHeight',        value:'innerHeight',                   meta:'property',doc:'Viewport height'},
            {name:'scrollX',            value:'scrollX',                       meta:'property',doc:'Horizontal scroll'},
            {name:'scrollY',            value:'scrollY',                       meta:'property',doc:'Vertical scroll'},
            {name:'location',           value:'location',                      meta:'property',doc:'Current URL info'},
            {name:'history',            value:'history',                       meta:'property',doc:'Browser history'},
            {name:'navigator',          value:'navigator',                     meta:'property',doc:'Browser info'},
        ],
    },

    // ── TypeScript shares JS completions ────────────────────────────
    typescript: {},

    // ── Go ───────────────────────────────────────────────────────────
    go: {
        fmt: [
            {name:'Println',  snip:'Println(${1:a})',                    meta:'function', doc:'Print with newline'},
            {name:'Printf',   snip:'Printf("${1:%v}\\n", ${2:a})',       meta:'function', doc:'Formatted print'},
            {name:'Sprintf',  snip:'Sprintf("${1:%v}", ${2:a})',         meta:'function', doc:'Formatted string'},
            {name:'Fprintf',  snip:'Fprintf(${1:w}, "${2:%v}", ${3:a})',meta:'function', doc:'Formatted write'},
            {name:'Errorf',   snip:'Errorf("${1:msg}: %w", ${2:err})',  meta:'function', doc:'Create formatted error'},
            {name:'Sscanf',   snip:'Sscanf(${1:str}, "${2:format}", ${3:&v})', meta:'function', doc:'Scan formatted string'},
            {name:'Scan',     snip:'Scan(${1:&v})',                      meta:'function', doc:'Read from stdin'},
        ],
        strings: [
            {name:'Contains',     snip:'Contains(${1:s}, "${2:substr}")',      meta:'function', doc:'Does s contain substr?'},
            {name:'HasPrefix',    snip:'HasPrefix(${1:s}, "${2:prefix}")',     meta:'function', doc:'Does s start with prefix?'},
            {name:'HasSuffix',    snip:'HasSuffix(${1:s}, "${2:suffix}")',     meta:'function', doc:'Does s end with suffix?'},
            {name:'Split',        snip:'Split(${1:s}, "${2:sep}")',            meta:'function', doc:'Split by separator'},
            {name:'Join',         snip:'Join(${1:elems}, "${2:sep}")',         meta:'function', doc:'Join with separator'},
            {name:'Replace',      snip:'Replace(${1:s}, "${2:old}", "${3:new}", ${4:-1})', meta:'function', doc:'Replace occurrences'},
            {name:'TrimSpace',    snip:'TrimSpace(${1:s})',                    meta:'function', doc:'Trim whitespace'},
            {name:'ToLower',      snip:'ToLower(${1:s})',                      meta:'function', doc:'Lowercase string'},
            {name:'ToUpper',      snip:'ToUpper(${1:s})',                      meta:'function', doc:'Uppercase string'},
            {name:'Index',        snip:'Index(${1:s}, "${2:substr}")',         meta:'function', doc:'First index of substr'},
            {name:'Count',        snip:'Count(${1:s}, "${2:substr}")',         meta:'function', doc:'Non-overlapping occurrences'},
            {name:'Repeat',       snip:'Repeat(${1:s}, ${2:n})',              meta:'function', doc:'Repeat string n times'},
            {name:'Trim',         snip:'Trim(${1:s}, "${2:cutset}")',          meta:'function', doc:'Trim leading/trailing chars'},
            {name:'Fields',       snip:'Fields(${1:s})',                       meta:'function', doc:'Split on whitespace'},
            {name:'Builder',      snip:'Builder{}',                            meta:'type',     doc:'Efficient string builder'},
        ],
        strconv: [
            {name:'Itoa',         snip:'Itoa(${1:i})',                         meta:'function', doc:'int → string'},
            {name:'Atoi',         snip:'Atoi(${1:s})',                         meta:'function', doc:'string → int'},
            {name:'FormatFloat',  snip:'FormatFloat(${1:f}, ${2:\'f\'}, ${3:-1}, ${4:64})', meta:'function', doc:'float → string'},
            {name:'ParseFloat',   snip:'ParseFloat(${1:s}, ${2:64})',          meta:'function', doc:'string → float'},
            {name:'FormatInt',    snip:'FormatInt(${1:i}, ${2:10})',           meta:'function', doc:'int → string (base)'},
            {name:'ParseInt',     snip:'ParseInt(${1:s}, ${2:10}, ${3:64})',   meta:'function', doc:'string → int (base)'},
            {name:'FormatBool',   snip:'FormatBool(${1:b})',                   meta:'function', doc:'bool → string'},
            {name:'ParseBool',    snip:'ParseBool(${1:s})',                    meta:'function', doc:'string → bool'},
        ],
        math: [
            {name:'Sqrt',    snip:'Sqrt(${1:x})',          meta:'function', doc:'Square root'},
            {name:'Abs',     snip:'Abs(${1:x})',           meta:'function', doc:'Absolute value'},
            {name:'Ceil',    snip:'Ceil(${1:x})',          meta:'function', doc:'Ceiling'},
            {name:'Floor',   snip:'Floor(${1:x})',         meta:'function', doc:'Floor'},
            {name:'Round',   snip:'Round(${1:x})',         meta:'function', doc:'Round to nearest'},
            {name:'Pow',     snip:'Pow(${1:x}, ${2:y})',  meta:'function', doc:'x^y'},
            {name:'Log',     snip:'Log(${1:x})',           meta:'function', doc:'Natural log'},
            {name:'Log2',    snip:'Log2(${1:x})',          meta:'function', doc:'Base-2 log'},
            {name:'Log10',   snip:'Log10(${1:x})',         meta:'function', doc:'Base-10 log'},
            {name:'Sin',     snip:'Sin(${1:x})',           meta:'function', doc:'Sine'},
            {name:'Cos',     snip:'Cos(${1:x})',           meta:'function', doc:'Cosine'},
            {name:'Tan',     snip:'Tan(${1:x})',           meta:'function', doc:'Tangent'},
            {name:'Min',     snip:'Min(${1:x}, ${2:y})',  meta:'function', doc:'Minimum of two'},
            {name:'Max',     snip:'Max(${1:x}, ${2:y})',  meta:'function', doc:'Maximum of two'},
            {name:'Inf',     snip:'Inf(${1:1})',           meta:'function', doc:'Positive/negative infinity'},
            {name:'IsNaN',   snip:'IsNaN(${1:x})',         meta:'function', doc:'Is NaN?'},
            {name:'Pi',      value:'Pi',                    meta:'constant', doc:'π ≈ 3.14159…'},
            {name:'E',       value:'E',                     meta:'constant', doc:"Euler's number"},
        ],
        os: [
            {name:'Open',       snip:'Open("${1:path}")',              meta:'function', doc:'Open file for reading'},
            {name:'Create',     snip:'Create("${1:path}")',            meta:'function', doc:'Create or truncate file'},
            {name:'Mkdir',      snip:'Mkdir("${1:path}", ${2:0755})',  meta:'function', doc:'Create directory'},
            {name:'MkdirAll',   snip:'MkdirAll("${1:path}", ${2:0755})', meta:'function', doc:'Create directories'},
            {name:'Remove',     snip:'Remove("${1:path}")',            meta:'function', doc:'Remove file'},
            {name:'RemoveAll',  snip:'RemoveAll("${1:path}")',         meta:'function', doc:'Remove path recursively'},
            {name:'Rename',     snip:'Rename("${1:old}", "${2:new}")',meta:'function', doc:'Rename file'},
            {name:'Getenv',     snip:'Getenv("${1:key}")',             meta:'function', doc:'Get environment variable'},
            {name:'Setenv',     snip:'Setenv("${1:key}", "${2:val}")',meta:'function', doc:'Set environment variable'},
            {name:'Exit',       snip:'Exit(${1:0})',                   meta:'function', doc:'Exit program'},
            {name:'Args',       value:'Args',                           meta:'variable', doc:'Command-line arguments'},
            {name:'Stdin',      value:'Stdin',                          meta:'variable', doc:'Standard input'},
            {name:'Stdout',     value:'Stdout',                         meta:'variable', doc:'Standard output'},
            {name:'Stderr',     value:'Stderr',                         meta:'variable', doc:'Standard error'},
        ],
    },
};
// TypeScript shares all JS module completions
MODULE_COMPLETIONS.typescript = MODULE_COMPLETIONS.javascript;

// ── Custom Ace completer (VS Code-style) ─────────────────────────
function _registerAceCompleter() {
    if (typeof ace === 'undefined') return;
    let langTools;
    try { langTools = ace.require('ace/ext/language_tools'); } catch(_) { return; }
    if (!langTools) return;

    langTools.addCompleter({
        getCompletions(editor, session, pos, prefix, callback) {
            const lang = vaultCodeLang;

            // ── Dot completion: detect "module.memberPrefix" ──────────
            const line         = session.getLine(pos.row);
            const beforePrefix = line.substring(0, pos.column - prefix.length);
            const dotMatch     = beforePrefix.match(/(\w+)\.$/);
            if (dotMatch) {
                const obj     = dotMatch[1];
                const modDb   = MODULE_COMPLETIONS[lang];
                const members = modDb?.[obj];
                if (members && members.length > 0) {
                    const pfx = prefix.toLowerCase();
                    const completions = members
                        .filter(m => !pfx || m.name.toLowerCase().startsWith(pfx))
                        .map(m => ({
                            caption:  m.name,
                            snippet:  m.snip  || undefined,
                            value:    m.snip  ? undefined : (m.value || m.name),
                            meta:     m.meta,
                            docHTML:  `<b>${obj}.${m.name}</b><br><span style="color:#9ca3af">${m.doc}</span>`,
                            score:    1200 + (pfx && m.name.toLowerCase().startsWith(pfx) ? 100 : 0),
                        }));
                    return callback(null, completions);
                }
                // Unknown object — return empty so Ace falls back to word completer
                return callback(null, []);
            }

            // ── Regular (keyword / snippet / built-in) completions ────
            if (!prefix || prefix.length < 1) return callback(null, []);
            const db = LANG_COMPLETIONS[lang];
            if (!db) return callback(null, []);

            const pfx = prefix.toLowerCase();
            const completions = [];

            // Snippets (highest priority)
            (db.snippets || []).forEach(s => {
                const capL = s.cap.toLowerCase();
                if (capL.startsWith(pfx) || (pfx.length >= 2 && capL.includes(pfx))) {
                    completions.push({
                        caption: s.cap,
                        snippet: s.snip,
                        meta:    s.meta,
                        docHTML: `<b>${s.cap}</b><br><span style="color:#9ca3af">${s.doc}</span>`,
                        score:   1000 + (capL.startsWith(pfx) ? 100 : 0),
                        type:    'snippet',
                    });
                }
            });

            // Built-ins
            (db.builtins || []).forEach(bi => {
                if (bi.toLowerCase().startsWith(pfx)) {
                    completions.push({ caption: bi, value: bi, meta: 'built-in', score: 600 });
                }
            });

            // Keywords
            (db.keywords || []).forEach(kw => {
                if (kw.toLowerCase().startsWith(pfx)) {
                    completions.push({ caption: kw, value: kw, meta: 'keyword', score: 300 });
                }
            });

            callback(null, completions);
        },
    });
}

// ── Theme registry ────────────────────────────────────────────────
const ACE_THEMES = [
    // ── Dark ──
    { id:'monokai',             label:'Monokai',            bg:'#272822', dark:true,
      term:{ background:'#272822',foreground:'#f8f8f2',cursor:'#f8f8f0',
             black:'#272822',red:'#f92672',green:'#a6e22e',yellow:'#f4bf75',
             blue:'#66d9ef',magenta:'#ae81ff',cyan:'#a1efe4',white:'#f8f8f2',
             brightBlack:'#75715e',brightRed:'#f92672',brightGreen:'#a6e22e',
             brightYellow:'#f4bf75',brightBlue:'#66d9ef',brightMagenta:'#ae81ff',
             brightCyan:'#a1efe4',brightWhite:'#f9f8f5' } },
    { id:'dracula',             label:'Dracula',            bg:'#282a36', dark:true,
      term:{ background:'#282a36',foreground:'#f8f8f2',cursor:'#f8f8f0',
             black:'#21222c',red:'#ff5555',green:'#50fa7b',yellow:'#f1fa8c',
             blue:'#bd93f9',magenta:'#ff79c6',cyan:'#8be9fd',white:'#f8f8f2',
             brightBlack:'#6272a4',brightRed:'#ff6e6e',brightGreen:'#69ff94',
             brightYellow:'#ffffa5',brightBlue:'#d6acff',brightMagenta:'#ff92df',
             brightCyan:'#a4ffff',brightWhite:'#ffffff' } },
    { id:'one_dark',            label:'One Dark',           bg:'#282c34', dark:true,
      term:{ background:'#282c34',foreground:'#abb2bf',cursor:'#528bff',
             black:'#3f4451',red:'#e06c75',green:'#98c379',yellow:'#e5c07b',
             blue:'#61afef',magenta:'#c678dd',cyan:'#56b6c2',white:'#abb2bf',
             brightBlack:'#4f5666',brightRed:'#ff616e',brightGreen:'#a5e075',
             brightYellow:'#f0a45d',brightBlue:'#4dc4ff',brightMagenta:'#de73ff',
             brightCyan:'#4cd1e0',brightWhite:'#ffffff' } },
    { id:'tomorrow_night',      label:'Tomorrow Night',     bg:'#1d1f21', dark:true,
      term:{ background:'#1d1f21',foreground:'#c5c8c6',cursor:'#aeafad',
             black:'#1d1f21',red:'#cc6666',green:'#b5bd68',yellow:'#f0c674',
             blue:'#81a2be',magenta:'#b294bb',cyan:'#8abeb7',white:'#c5c8c6',
             brightBlack:'#666666',brightRed:'#d54e53',brightGreen:'#b9ca4a',
             brightYellow:'#e7c547',brightBlue:'#7aa6da',brightMagenta:'#c397d8',
             brightCyan:'#70c0b1',brightWhite:'#eaeaea' } },
    { id:'nord_dark',           label:'Nord',               bg:'#2e3440', dark:true,
      term:{ background:'#2e3440',foreground:'#d8dee9',cursor:'#d8dee9',
             black:'#3b4252',red:'#bf616a',green:'#a3be8c',yellow:'#ebcb8b',
             blue:'#81a1c1',magenta:'#b48ead',cyan:'#88c0d0',white:'#e5e9f0',
             brightBlack:'#4c566a',brightRed:'#bf616a',brightGreen:'#a3be8c',
             brightYellow:'#ebcb8b',brightBlue:'#81a1c1',brightMagenta:'#b48ead',
             brightCyan:'#8fbcbb',brightWhite:'#eceff4' } },
    { id:'github_dark',         label:'GitHub Dark',        bg:'#0d1117', dark:true,
      term:{ background:'#0d1117',foreground:'#e6edf3',cursor:'#e6edf3',
             black:'#484f58',red:'#ff7b72',green:'#3fb950',yellow:'#d29922',
             blue:'#58a6ff',magenta:'#bc8cff',cyan:'#39c5cf',white:'#b1bac4',
             brightBlack:'#6e7681',brightRed:'#ffa198',brightGreen:'#56d364',
             brightYellow:'#e3b341',brightBlue:'#79c0ff',brightMagenta:'#d2a8ff',
             brightCyan:'#56d4dd',brightWhite:'#f0f6fc' } },
    { id:'solarized_dark',      label:'Solarized Dark',     bg:'#002b36', dark:true,
      term:{ background:'#002b36',foreground:'#839496',cursor:'#839496',
             black:'#073642',red:'#dc322f',green:'#859900',yellow:'#b58900',
             blue:'#268bd2',magenta:'#d33682',cyan:'#2aa198',white:'#eee8d5',
             brightBlack:'#002b36',brightRed:'#cb4b16',brightGreen:'#586e75',
             brightYellow:'#657b83',brightBlue:'#839496',brightMagenta:'#6c71c4',
             brightCyan:'#93a1a1',brightWhite:'#fdf6e3' } },
    { id:'cobalt',              label:'Cobalt',             bg:'#002240', dark:true,
      term:{ background:'#002240',foreground:'#ffffff',cursor:'#ffee80',
             black:'#000000',red:'#ff0000',green:'#00ff00',yellow:'#ffd700',
             blue:'#0080ff',magenta:'#ff00ff',cyan:'#00ffff',white:'#ffffff',
             brightBlack:'#555555',brightRed:'#ff5555',brightGreen:'#55ff55',
             brightYellow:'#ffff55',brightBlue:'#5555ff',brightMagenta:'#ff55ff',
             brightCyan:'#55ffff',brightWhite:'#ffffff' } },
    { id:'tomorrow_night_blue', label:'Night Blue',         bg:'#002451', dark:true,
      term:{ background:'#002451',foreground:'#ffffff',cursor:'#ffffff',
             black:'#00346e',red:'#ff9da4',green:'#d1f1a9',yellow:'#ffeead',
             blue:'#bbdaff',magenta:'#ebbbff',cyan:'#99ffff',white:'#ffffff',
             brightBlack:'#0052a5',brightRed:'#ff4754',brightGreen:'#bcf0a4',
             brightYellow:'#f5d67a',brightBlue:'#6baff6',brightMagenta:'#e571ff',
             brightCyan:'#7fffff',brightWhite:'#ffffff' } },
    { id:'vibrant_ink',         label:'Vibrant Ink',        bg:'#0f0f0f', dark:true,
      term:{ background:'#0f0f0f',foreground:'#ffffff',cursor:'#ff6600',
             black:'#0f0f0f',red:'#ff0000',green:'#00ff00',yellow:'#ffff00',
             blue:'#0000ff',magenta:'#ff00ff',cyan:'#00ffff',white:'#ffffff',
             brightBlack:'#555555',brightRed:'#ff5555',brightGreen:'#55ff55',
             brightYellow:'#ffff55',brightBlue:'#5555ff',brightMagenta:'#ff55ff',
             brightCyan:'#55ffff',brightWhite:'#ffffff' } },
    // ── Light ──
    { id:'github',              label:'GitHub Light',       bg:'#ffffff', dark:false,
      term:{ background:'#f6f8fa',foreground:'#24292f',cursor:'#24292f',
             black:'#24292f',red:'#cf222e',green:'#116329',yellow:'#4d2d00',
             blue:'#0969da',magenta:'#8250df',cyan:'#1b7c83',white:'#6e7781',
             brightBlack:'#57606a',brightRed:'#a40e26',brightGreen:'#1a7f37',
             brightYellow:'#633c01',brightBlue:'#218bff',brightMagenta:'#a475f9',
             brightCyan:'#3192aa',brightWhite:'#8c959f' } },
    { id:'solarized_light',     label:'Solarized Light',    bg:'#fdf6e3', dark:false,
      term:{ background:'#fdf6e3',foreground:'#657b83',cursor:'#657b83',
             black:'#073642',red:'#dc322f',green:'#859900',yellow:'#b58900',
             blue:'#268bd2',magenta:'#d33682',cyan:'#2aa198',white:'#eee8d5',
             brightBlack:'#002b36',brightRed:'#cb4b16',brightGreen:'#586e75',
             brightYellow:'#657b83',brightBlue:'#839496',brightMagenta:'#6c71c4',
             brightCyan:'#93a1a1',brightWhite:'#fdf6e3' } },
    { id:'xcode',               label:'Xcode',              bg:'#ffffff', dark:false,
      term:{ background:'#ffffff',foreground:'#000000',cursor:'#000000',
             black:'#000000',red:'#c41a16',green:'#007400',yellow:'#836c28',
             blue:'#0000ff',magenta:'#9b2393',cyan:'#007481',white:'#ffffff',
             brightBlack:'#555555',brightRed:'#ff0000',brightGreen:'#00d900',
             brightYellow:'#e5e500',brightBlue:'#0000ff',brightMagenta:'#e500e5',
             brightCyan:'#00e5e5',brightWhite:'#e5e5e5' } },
    { id:'eclipse',             label:'Eclipse',            bg:'#ffffff', dark:false,
      term:{ background:'#ffffff',foreground:'#000000',cursor:'#000000',
             black:'#000000',red:'#ff0000',green:'#00c800',yellow:'#c8c800',
             blue:'#0000ff',magenta:'#c800c8',cyan:'#00c8c8',white:'#c8c8c8',
             brightBlack:'#808080',brightRed:'#ff0000',brightGreen:'#00ff00',
             brightYellow:'#ffff00',brightBlue:'#0000ff',brightMagenta:'#ff00ff',
             brightCyan:'#00ffff',brightWhite:'#ffffff' } },
];

// ── Editor state ──────────────────────────────────────────────────
let vaultAceEditor     = null;
let vaultCodeSaveTimer = null;
let vaultCodeProcess   = null;  // current run process
let vaultCodeFilePath  = null;
let vaultCodeLang      = 'python';
let vaultCodeWrap      = false;
let vaultCodeThemeId   = localStorage.getItem('vulsor_code_theme') || 'monokai';

// ── Terminal state ────────────────────────────────────────────────
let vaultTerm          = null;  // xterm Terminal instance
let vaultFitAddon      = null;
let vaultTermCwd       = os.homedir();
let vaultTermProc      = null;  // current command process (not the persistent shell)
let vaultTermHistory   = [];
let vaultTermHistIdx   = -1;
let vaultTermLine      = '';    // current input line
let vaultTermRunning   = false; // is a command currently executing?
let vaultTermOpen      = false;

// ──────────────────────────────────────────────────────────────────
// INIT  (buttons only — Ace is lazy-inited when editor first opens)
// ──────────────────────────────────────────────────────────────────
function initVaultCodeEditor() {
    // Toolbar buttons
    document.getElementById('vault-code-run-btn').addEventListener('click',  runVaultCode);
    document.getElementById('vault-code-kill-btn').addEventListener('click', killVaultCode);
    document.getElementById('vault-code-clear-btn').addEventListener('click',clearCodeOutput);

    document.getElementById('vault-code-wrap-btn').addEventListener('click', () => {
        vaultCodeWrap = !vaultCodeWrap;
        if (vaultAceEditor) vaultAceEditor.session.setUseWrapMode(vaultCodeWrap);
        const btn = document.getElementById('vault-code-wrap-btn');
        btn.classList.toggle('text-cyan-400',  vaultCodeWrap);
        btn.classList.toggle('text-slate-500', !vaultCodeWrap);
    });

    document.getElementById('vault-code-lang-select').addEventListener('change', e => {
        vaultCodeLang = e.target.value;
        const info = VAULT_CODE_LANGS[vaultCodeLang];
        if (vaultAceEditor && info) vaultAceEditor.session.setMode(`ace/mode/${info.mode}`);
        document.getElementById('vault-code-run-btn').style.display = info?.cmd ? '' : 'none';
    });

    document.getElementById('vault-code-theme-btn').addEventListener('click', e => {
        vaultCodeShowThemePicker(e.currentTarget);
    });

    // Terminal toggle
    document.getElementById('vault-code-terminal-btn').addEventListener('click', toggleCodeTerminal);
    document.getElementById('vault-code-term-close-btn').addEventListener('click', () => {
        _setTerminalVisible(false);
    });
    document.getElementById('vault-code-term-new-btn').addEventListener('click', () => {
        vaultTermCwd = os.homedir();
        if (vaultTerm) { vaultTerm.clear(); _writeTermPrompt(); }
    });
    document.getElementById('vault-code-term-kill-btn').addEventListener('click', () => {
        if (vaultTermProc) { try { vaultTermProc.kill('SIGTERM'); } catch(_) {} vaultTermProc = null; }
        if (vaultTerm) { vaultTerm.write('\r\n\x1b[33m[killed]\x1b[0m\r\n'); _writeTermPrompt(); }
        vaultTermRunning = false;
        vaultTermLine = '';
    });

    // Resizers
    _initHorizResize();
    _initVertResize();

    // Language picker modal
    _buildLangGrid();
    document.getElementById('vault-code-lang-modal-cancel').addEventListener('click', () => {
        document.getElementById('vault-code-lang-modal').classList.remove('open');
    });
    document.getElementById('vault-new-code-btn').addEventListener('click', () => {
        document.getElementById('vault-code-lang-modal').classList.add('open');
    });
}

// ──────────────────────────────────────────────────────────────────
// LAZY ACE INIT  (called after the editor pane is visible)
// ──────────────────────────────────────────────────────────────────
function _ensureAceInit(onReady) {
    if (vaultAceEditor) { if (onReady) onReady(); return; }
    // Ace is no longer part of the startup bundle — a megabyte and a half of
    // editor that most sessions never open. Fetch it the first time one is,
    // then come back here and carry on.
    if (typeof ace === 'undefined') {
        if (typeof vulsorLoadAce !== 'function') { console.warn('[Vulsor] Ace editor not loaded'); return; }
        vulsorLoadAce()
            .then(() => _ensureAceInit(onReady))
            .catch(e => {
                console.error('[Vulsor] Ace failed to load:', e);
                const host = document.getElementById('vault-code-ace');
                if (host && typeof uiUnavailable === 'function') uiUnavailable(host, {
                    icon: 'fa-code', title: 'The code editor couldn\'t load',
                    detail: 'Part of the editor failed to load from disk. Retrying usually fixes it; if not, reinstalling Vulsor restores the missing files.',
                    action: 'Retry', onAction: () => { host.querySelector('.ui-unavailable')?.remove(); _ensureAceInit(onReady); },
                });
            });
        return;
    }

    ace.config.set('useWorker', false);
    try { ace.require('ace/ext/language_tools'); } catch(_) {}

    vaultAceEditor = ace.edit('vault-code-ace');
    vaultAceEditor.setOptions({
        fontSize:                  '13px',
        fontFamily:                "'Fira Code', 'JetBrains Mono', Menlo, Consolas, monospace",
        showPrintMargin:           false,
        enableBasicAutocompletion: true,
        enableLiveAutocompletion:  true,   // show dropdown as you type
        enableSnippets:            true,   // enable tab-stop expansion
        tabSize:                   4,
        useSoftTabs:               true,
        wrap:                      false,
        scrollPastEnd:             0.5,
        showLineNumbers:           true,
        showGutter:                true,
        highlightActiveLine:       true,
        displayIndentGuides:       true,
    });

    // Register custom VS Code-style completer BEFORE applying theme
    _registerAceCompleter();

    _applyAceTheme(vaultCodeThemeId);

    // Auto-save on change
    vaultAceEditor.session.on('change', () => {
        const el = document.getElementById('vault-code-status');
        if (el) el.textContent = 'saving…';
        clearTimeout(vaultCodeSaveTimer);
        vaultCodeSaveTimer = setTimeout(saveVaultCodeFile, 800);
    });

    // Keep Ace filling the wrapper whenever the pane is resized
    const wrap = document.getElementById('vault-code-ace-wrap');
    if (wrap && window.ResizeObserver) {
        new ResizeObserver(() => {
            if (vaultAceEditor) vaultAceEditor.resize(true);
        }).observe(wrap);
    }
}

// ──────────────────────────────────────────────────────────────────
// THEME PICKER
// ──────────────────────────────────────────────────────────────────
function vaultCodeShowThemePicker(anchor) {
    const existingId = 'vault-code-theme-popup';
    const existing = document.getElementById(existingId);
    if (existing) { existing.remove(); return; }

    const popup = document.createElement('div');
    popup.id = existingId;
    popup.className = 'absolute z-50 bg-slate-900 border border-slate-700/80 rounded-2xl p-4 shadow-2xl';
    popup.style.cssText = 'min-width:340px;right:8px;top:calc(100% + 4px)';

    const darkThemes  = ACE_THEMES.filter(t =>  t.dark);
    const lightThemes = ACE_THEMES.filter(t => !t.dark);

    const renderGroup = (label, themes) => `
        <p class="text-slate-500 text-[10px] uppercase tracking-widest font-semibold mb-2">${label}</p>
        <div class="grid grid-cols-5 gap-1.5 mb-3">
            ${themes.map(t => `
                <button class="vault-theme-swatch flex flex-col items-center gap-1 p-1.5 rounded-xl border-2 transition-all ${t.id === vaultCodeThemeId ? 'border-cyan-400' : 'border-transparent hover:border-slate-600'}" data-tid="${t.id}" title="${t.label}">
                    <div class="w-10 h-6 rounded-md border border-slate-700/40" style="background:${t.bg}"></div>
                    <span class="text-[9px] text-slate-400 leading-none">${t.label}</span>
                </button>`).join('')}
        </div>`;

    popup.innerHTML = `
        <p class="text-slate-200 text-xs font-semibold mb-3 flex items-center gap-2">
            <i class="fas fa-palette text-cyan-400"></i> Editor Theme
        </p>
        ${renderGroup('Dark', darkThemes)}
        ${renderGroup('Light', lightThemes)}`;

    // Attach to toolbar row (relative positioned)
    const toolbar = document.getElementById('vault-code-toolbar-row');
    toolbar.style.position = 'relative';
    toolbar.appendChild(popup);

    popup.querySelectorAll('.vault-theme-swatch').forEach(btn => {
        btn.addEventListener('click', () => {
            vaultCodeThemeId = btn.dataset.tid;
            localStorage.setItem('vulsor_code_theme', vaultCodeThemeId);
            _applyAceTheme(vaultCodeThemeId);
            // Update terminal theme too
            const t = ACE_THEMES.find(x => x.id === vaultCodeThemeId);
            if (t && vaultTerm) vaultTerm.options.theme = t.term;
            // Update editor bg
            const pane = document.getElementById('vault-code-editor-pane');
            if (pane && t) pane.style.background = t.bg;
            popup.remove();
        });
    });

    const close = e => {
        if (!popup.contains(e.target) && e.target !== anchor) {
            popup.remove(); document.removeEventListener('mousedown', close);
        }
    };
    setTimeout(() => document.addEventListener('mousedown', close), 0);
}

function _applyAceTheme(themeId) {
    if (!vaultAceEditor) return;
    vaultAceEditor.setTheme(`ace/theme/${themeId}`);
    // Update editor pane background to match
    const t = ACE_THEMES.find(x => x.id === themeId);
    const pane = document.getElementById('vault-code-editor-pane');
    if (pane && t) pane.style.background = t.bg;
}

// ──────────────────────────────────────────────────────────────────
// RESIZERS
// ──────────────────────────────────────────────────────────────────
function _initHorizResize() {
    const resizer = document.getElementById('vault-code-resizer');
    const panel   = document.getElementById('vault-code-output-panel');
    let resizing = false, startX = 0, startW = 0;
    resizer.addEventListener('mousedown', e => {
        e.preventDefault(); resizing = true; startX = e.clientX; startW = panel.offsetWidth;
        document.body.classList.add('vault-resizing');
    });
    document.addEventListener('mousemove', e => {
        if (!resizing) return;
        panel.style.width = Math.min(700, Math.max(160, startW + (startX - e.clientX))) + 'px';
        if (vaultAceEditor) vaultAceEditor.resize();
    });
    document.addEventListener('mouseup', () => {
        if (!resizing) return; resizing = false;
        document.body.classList.remove('vault-resizing');
    });
}

function _initVertResize() {
    const resizer = document.getElementById('vault-code-v-resizer');
    const termWrap = document.getElementById('vault-code-terminal-wrap');
    let resizing = false, startY = 0, startH = 0;
    resizer.addEventListener('mousedown', e => {
        e.preventDefault(); resizing = true; startY = e.clientY; startH = termWrap.offsetHeight;
        document.body.classList.add('vault-resizing');
    });
    document.addEventListener('mousemove', e => {
        if (!resizing) return;
        const newH = Math.min(800, Math.max(80, startH + (startY - e.clientY)));
        termWrap.style.height = newH + 'px';
        if (vaultAceEditor) vaultAceEditor.resize();
        _fitTerm();
    });
    document.addEventListener('mouseup', () => {
        if (!resizing) return; resizing = false;
        document.body.classList.remove('vault-resizing');
    });
}

// ──────────────────────────────────────────────────────────────────
// TERMINAL
// ──────────────────────────────────────────────────────────────────
function toggleCodeTerminal() {
    _setTerminalVisible(!vaultTermOpen);
}

function _setTerminalVisible(visible) {
    vaultTermOpen = visible;
    const wrap    = document.getElementById('vault-code-terminal-wrap');
    const vRes    = document.getElementById('vault-code-v-resizer');
    const btn     = document.getElementById('vault-code-terminal-btn');
    wrap.style.display = visible ? 'flex' : 'none';
    vRes.style.display = visible ? ''     : 'none';
    btn.classList.toggle('text-cyan-400', visible);
    btn.classList.toggle('text-slate-500', !visible);

    if (visible) {
        _ensureTerminalInit();
        setTimeout(() => {
            _fitTerm();
            if (vaultTerm) vaultTerm.focus();
            if (vaultAceEditor) vaultAceEditor.resize();
        }, 50);
    } else {
        if (vaultAceEditor) setTimeout(() => vaultAceEditor.resize(), 50);
    }
}

function _ensureTerminalInit() {
    if (vaultTerm) return; // already initialised

    // Load xterm via require() — NOT via globals.
    // In Electron with nodeIntegration:true, UMD libs loaded via <script> tags
    // detect Node's module/exports globals and export via module.exports instead
    // of window.X, so globals like window.Terminal are never set.
    // require() is the only reliable way to get them.
    let TermClass, FitClass;
    try {
        const xterm    = require('./js/xterm/xterm.js');
        const fitaddon = require('./js/xterm/xterm-addon-fit.js');
        TermClass = xterm.Terminal;
        FitClass  = fitaddon.FitAddon;
    } catch(e) {
        console.error('[Vulsor] Failed to load xterm:', e);
        return;
    }
    if (!TermClass) { console.error('[Vulsor] xterm Terminal class not found'); return; }

    const theme = (ACE_THEMES.find(t => t.id === vaultCodeThemeId) || ACE_THEMES[0]).term;

    vaultTerm = new TermClass({
        theme,
        fontSize:      13,
        fontFamily:    "'Fira Code', 'JetBrains Mono', Menlo, Consolas, monospace",
        cursorBlink:   true,
        cursorStyle:   'block',
        scrollback:    5000,
        allowTransparency: false,
    });

    if (FitClass) {
        vaultFitAddon = new FitClass();
        vaultTerm.loadAddon(vaultFitAddon);
    }

    const termEl = document.getElementById('vault-code-term');
    vaultTerm.open(termEl);
    _fitTerm();

    // Clicking the terminal area always refocuses it
    termEl.addEventListener('mousedown', () => {
        setTimeout(() => { if (vaultTerm) vaultTerm.focus(); }, 0);
    });

    // Welcome message
    vaultTerm.writeln('\x1b[36m╔══════════════════════════════════╗\x1b[0m');
    vaultTerm.writeln('\x1b[36m║   Vulsor Integrated Terminal  🚀  ║\x1b[0m');
    vaultTerm.writeln('\x1b[36m╚══════════════════════════════════╝\x1b[0m');
    vaultTerm.writeln('\x1b[90mType any shell command. Use ↑↓ for history.\x1b[0m');
    vaultTerm.writeln('');
    _writeTermPrompt();

    // Key / data handler
    vaultTerm.onData(_handleTermData);

    // Resize observer
    if (window.ResizeObserver) {
        new ResizeObserver(() => _fitTerm()).observe(termEl);
    }
}

function _fitTerm() {
    if (!vaultTerm) return;
    if (vaultFitAddon) { try { vaultFitAddon.fit(); } catch(_) {} return; }
    // Manual fit fallback
    const el = document.getElementById('vault-code-term');
    if (!el) return;
    const W = el.clientWidth  - 8;
    const H = el.clientHeight - 8;
    const cols = Math.max(10, Math.floor(W / 7.8));
    const rows = Math.max(2,  Math.floor(H / 17));
    try { vaultTerm.resize(cols, rows); } catch(_) {}
}

function _writeTermPrompt() {
    if (!vaultTerm) return;
    const home = os.homedir();
    const disp = vaultTermCwd.startsWith(home)
        ? '\x1b[96m~' + vaultTermCwd.slice(home.length) + '\x1b[0m'
        : '\x1b[96m' + vaultTermCwd + '\x1b[0m';
    vaultTerm.write(`\x1b[32m➜\x1b[0m ${disp} \x1b[97m$\x1b[0m `);
}

function _handleTermData(data) {
    if (vaultTermRunning) {
        // Forward ALL keyboard input to the running process stdin
        // (enables interactive programs: pip install, python REPL, etc.)
        if (vaultTermProc) {
            if (data === '\x03') {
                // Ctrl+C → SIGINT
                try { vaultTermProc.kill('SIGINT'); } catch(_) {}
            } else if (vaultTermProc.stdin && !vaultTermProc.stdin.destroyed) {
                // xterm sends \r for Enter; processes expect \n
                try { vaultTermProc.stdin.write(data === '\r' ? '\n' : data); } catch(_) {}
            }
        }
        return;
    }

    const code = data.charCodeAt(0);

    // Enter
    if (data === '\r') {
        const cmd = vaultTermLine.trim();
        vaultTerm.write('\r\n');
        vaultTermLine = '';
        vaultTermHistIdx = -1;
        if (cmd) {
            vaultTermHistory.unshift(cmd);
            _execTermCmd(cmd);
        } else {
            _writeTermPrompt();
        }
        return;
    }

    // Backspace
    if (data === '\x7f' || data === '\b') {
        if (vaultTermLine.length > 0) {
            vaultTermLine = vaultTermLine.slice(0, -1);
            vaultTerm.write('\b \b');
        }
        return;
    }

    // Ctrl+C (cancel current line)
    if (data === '\x03') {
        vaultTerm.write('^C\r\n');
        vaultTermLine = '';
        vaultTermHistIdx = -1;
        _writeTermPrompt();
        return;
    }

    // Ctrl+L (clear)
    if (data === '\x0c') {
        vaultTerm.clear();
        _writeTermPrompt();
        vaultTerm.write(vaultTermLine);
        return;
    }

    // Arrow Up (history)
    if (data === '\x1b[A') {
        if (vaultTermHistory.length === 0) return;
        vaultTermHistIdx = Math.min(vaultTermHistIdx + 1, vaultTermHistory.length - 1);
        _replaceTermLine(vaultTermHistory[vaultTermHistIdx]);
        return;
    }

    // Arrow Down (history)
    if (data === '\x1b[B') {
        if (vaultTermHistIdx <= 0) {
            vaultTermHistIdx = -1;
            _replaceTermLine('');
        } else {
            vaultTermHistIdx--;
            _replaceTermLine(vaultTermHistory[vaultTermHistIdx]);
        }
        return;
    }

    // Arrow Left / Right (cursor movement — basic: ignore for now)
    if (data === '\x1b[C' || data === '\x1b[D') return;

    // Tab (basic autocomplete stub — just insert spaces)
    if (data === '\t') {
        vaultTerm.write('    '); vaultTermLine += '    ';
        return;
    }

    // Printable characters
    if (code >= 32 && code < 127) {
        vaultTermLine += data;
        vaultTerm.write(data);
    }
}

function _replaceTermLine(newLine) {
    // Erase current line content and replace
    const erase = '\b \b'.repeat(vaultTermLine.length);
    vaultTerm.write(erase);
    vaultTermLine = newLine;
    vaultTerm.write(newLine);
}

function _execTermCmd(rawCmd) {
    // Handle `cd` locally (it can't change the spawned process cwd)
    const cdMatch = rawCmd.match(/^cd\s*(.*)?$/);
    if (cdMatch) {
        const target = (cdMatch[1] || '').trim().replace(/^~/, os.homedir()) || os.homedir();
        const resolved = path.resolve(vaultTermCwd, target);
        try {
            const stat = require('fs').statSync(resolved);
            if (stat.isDirectory()) {
                vaultTermCwd = resolved;
            } else {
                vaultTerm.writeln(`\x1b[31mbash: cd: ${target}: Not a directory\x1b[0m`);
            }
        } catch(_) {
            vaultTerm.writeln(`\x1b[31mbash: cd: ${target}: No such file or directory\x1b[0m`);
        }
        _writeTermPrompt();
        return;
    }

    // Spawn command via user's login shell so ~/.zprofile / ~/.bash_profile
    // are sourced — this gives Homebrew, pyenv, conda, pip, etc. in PATH.
    vaultTermRunning = true;
    const { spawn } = require('child_process');
    const userShell = process.env.SHELL || '/bin/zsh';
    const proc = spawn(userShell, ['--login', '-c', rawCmd], {
        cwd: vaultTermCwd,
        env: Object.assign({}, process.env, {
            TERM: 'xterm-256color',
            COLORTERM: 'truecolor',
            FORCE_COLOR: '3',
            PYTHONUNBUFFERED: '1',
            PIP_PROGRESS_BAR: 'on',
        }),
    });
    vaultTermProc = proc;

    const write = data => {
        if (!vaultTerm) return;
        // Translate \n → \r\n for xterm
        vaultTerm.write(data.toString().replace(/\r?\n/g, '\r\n'));
    };

    proc.stdout.on('data', write);
    proc.stderr.on('data', write);

    proc.on('close', code => {
        vaultTermProc   = null;
        vaultTermRunning = false;
        // Show non-zero exit code subtly
        if (code !== 0 && code !== null) {
            vaultTerm.write(`\x1b[90m[exit ${code}]\x1b[0m\r\n`);
        }
        _writeTermPrompt();
    });

    proc.on('error', err => {
        vaultTermProc   = null;
        vaultTermRunning = false;
        vaultTerm.writeln(`\x1b[31m${err.message}\x1b[0m`);
        _writeTermPrompt();
    });
}

// ──────────────────────────────────────────────────────────────────
// LANGUAGE PICKER MODAL
// ──────────────────────────────────────────────────────────────────
function _buildLangGrid() {
    const grid = document.getElementById('vault-code-lang-grid');
    if (!grid) return;
    const RUNNABLE = Object.entries(VAULT_CODE_LANGS).filter(([,v]) =>  v.cmd);
    const MARKUP   = Object.entries(VAULT_CODE_LANGS).filter(([,v]) => !v.cmd);

    const card = ([key, info]) =>
        `<button class="vault-code-lang-pick flex flex-col items-center gap-1.5 p-3 rounded-xl bg-slate-800/60 hover:bg-slate-700/80 border border-slate-700/60 hover:border-cyan-500/50 transition-all text-center" data-lang="${key}">
            <span class="text-xl leading-none">${info.icon}</span>
            <span class="text-slate-200 text-[11px] font-medium leading-tight">${info.label}</span>
            <span class="text-slate-600 text-[9px]">.${info.ext[0]}</span>
        </button>`;

    grid.innerHTML =
        `<p class="col-span-3 text-slate-500 text-[10px] uppercase tracking-widest font-semibold mb-1">Runnable</p>`
        + RUNNABLE.map(card).join('')
        + `<p class="col-span-3 text-slate-500 text-[10px] uppercase tracking-widest font-semibold mt-3 mb-1">Markup / Data</p>`
        + MARKUP.map(card).join('');

    grid.querySelectorAll('.vault-code-lang-pick').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('vault-code-lang-modal').classList.remove('open');
            createVaultCodeFile(btn.dataset.lang);
        });
    });
}

// ──────────────────────────────────────────────────────────────────
// CREATE CODE FILE
// ──────────────────────────────────────────────────────────────────
function createVaultCodeFile(lang) {
    const info = VAULT_CODE_LANGS[lang] || VAULT_CODE_LANGS.python;
    const ext  = info.ext[0];
    const id   = 'vf_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    const storedName = id + '.' + ext;

    const BOILERPLATE = {
        python:     '# Python\nprint("Hello, World!")\n',
        javascript: '// JavaScript\nconsole.log("Hello, World!");\n',
        typescript: '// TypeScript\nconsole.log("Hello, World!");\n',
        shell:      '#!/bin/bash\necho "Hello, World!"\n',
        go:         'package main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, World!")\n}\n',
        ruby:       'puts "Hello, World!"\n',
        c:          '#include <stdio.h>\n\nint main() {\n\tprintf("Hello, World!\\n");\n\treturn 0;\n}\n',
        cpp:        '#include <iostream>\nusing namespace std;\n\nint main() {\n\tcout << "Hello, World!" << endl;\n\treturn 0;\n}\n',
        java:       'public class Main {\n\tpublic static void main(String[] args) {\n\t\tSystem.out.println("Hello, World!");\n\t}\n}\n',
        rust:       'fn main() {\n\tprintln!("Hello, World!");\n}\n',
        php:        '<?php\necho "Hello, World!";\n',
        perl:       '#!/usr/bin/perl\nuse strict;\nuse warnings;\nprint "Hello, World!\\n";\n',
        r:          'cat("Hello, World!\\n")\n',
        html:       '<!DOCTYPE html>\n<html lang="en">\n<head>\n\t<meta charset="UTF-8">\n\t<title>Page</title>\n</head>\n<body>\n\t<h1>Hello, World!</h1>\n</body>\n</html>\n',
    };

    const content = BOILERPLATE[lang] || '';
    fs.writeFileSync(path.join(VAULT_DIR, storedName), content, 'utf8');
    vaultData.files.unshift({
        id, originalName: `script.${ext}`, storedName,
        folderId: vaultActiveFolderId,
        notes: '', pageNotes: {}, addedAt: Date.now(),
        size: Buffer.byteLength(content, 'utf8'),
        isCode: true,
    });
    saveVaultData();
    renderVaultFolders();
    renderVaultGrid();
    openVaultFile(id);
}

// ──────────────────────────────────────────────────────────────────
// OPEN / CLOSE
// ──────────────────────────────────────────────────────────────────
function openVaultCodeEditor(file, storedPath) {
    vaultCodeFilePath = storedPath;

    const ext  = (file.originalName.split('.').pop() || '').toLowerCase();
    vaultCodeLang = vaultCodeExtToLang(ext);
    const info = VAULT_CODE_LANGS[vaultCodeLang] || VAULT_CODE_LANGS.text;

    // ── 1. Show / hide UI panels FIRST (so Ace can measure real dimensions)
    document.getElementById('vault-code-toolbar-row').style.display  = '';
    document.getElementById('vault-code-area').style.display          = 'flex';
    document.getElementById('vault-normal-view').style.display        = 'none';
    document.getElementById('vault-doc-toolbar-row').style.display    = 'none';
    document.getElementById('vault-doc-editor-area').style.display    = 'none';
    document.getElementById('vault-doc-footer').style.display         = 'none';

    // Editable title
    document.getElementById('vault-viewer-title').classList.add('hidden');
    const ti = document.getElementById('vault-doc-title-input');
    ti.classList.remove('hidden');
    ti.value = file.originalName;

    // Language selector
    const sel = document.getElementById('vault-code-lang-select');
    if (sel) sel.value = vaultCodeLang;

    document.getElementById('vault-code-run-btn').style.display  = info.cmd ? '' : 'none';
    document.getElementById('vault-code-kill-btn').style.display = 'none';

    clearCodeOutput();
    const statusEl = document.getElementById('vault-code-status');
    if (statusEl) statusEl.textContent = '';

    // ── 2. Now that the pane is visible, lazily initialise Ace
    //        (Ace needs real pixel dimensions to render correctly). The file is
    //        loaded in the callback because the first open also has to fetch Ace.
    _ensureAceInit(() => {
        if (!vaultAceEditor) return;
        vaultAceEditor.session.setMode(`ace/mode/${info.mode}`);
        const content = fs.existsSync(storedPath) ? fs.readFileSync(storedPath, 'utf8') : '';
        vaultAceEditor.setValue(content, -1);
        vaultAceEditor.clearSelection();
        vaultAceEditor.resize(true);
    });

    // Set terminal CWD
    vaultTermCwd = VAULT_DIR;

    // ── 3. Force Ace to recalculate layout after the DOM has fully painted
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (vaultAceEditor) vaultAceEditor.resize(true);
            _fitTerm();
        });
    });
    // Belt-and-suspenders: also resize after 250ms (handles slow theme loads)
    setTimeout(() => {
        if (vaultAceEditor) vaultAceEditor.resize(true);
    }, 250);
}

function closeVaultCodeEditor() {
    if (vaultCodeProcess) { try { vaultCodeProcess.kill(); } catch(_) {} vaultCodeProcess = null; }
    if (vaultTermProc)    { try { vaultTermProc.kill();    } catch(_) {} vaultTermProc    = null; }

    clearTimeout(vaultCodeSaveTimer);
    saveVaultCodeFile();

    document.getElementById('vault-code-area').style.display        = 'none';
    document.getElementById('vault-code-toolbar-row').style.display = 'none';
    document.getElementById('vault-normal-view').style.display      = '';
    document.getElementById('vault-viewer-title').classList.remove('hidden');
    document.getElementById('vault-doc-title-input').classList.add('hidden');

    // Hide terminal panel but keep xterm instance alive for next open
    _setTerminalVisible(false);

    vaultCodeFilePath = null;
}

// ──────────────────────────────────────────────────────────────────
// SAVE
// ──────────────────────────────────────────────────────────────────
function saveVaultCodeFile() {
    if (!vaultCodeFilePath || !vaultAceEditor) return;
    try {
        const content = vaultAceEditor.getValue();
        fs.writeFileSync(vaultCodeFilePath, content, 'utf8');
        const file = vaultData.files.find(f => f.id === vaultOpenFileId);
        if (file) { file.size = Buffer.byteLength(content, 'utf8'); file.updatedAt = Date.now(); saveVaultData(); }
        const el = document.getElementById('vault-code-status');
        if (el) el.textContent = 'saved';
    } catch(e) {
        const el = document.getElementById('vault-code-status');
        if (el) el.textContent = 'save failed';
    }
}

// ──────────────────────────────────────────────────────────────────
// RUN CODE
// ──────────────────────────────────────────────────────────────────
function clearCodeOutput() {
    const out = document.getElementById('vault-code-output');
    if (out) out.innerHTML = '';
}

function appendCodeOutput(text, cls) {
    const out = document.getElementById('vault-code-output');
    if (!out) return;
    const span = document.createElement('span');
    if (cls) span.className = cls;
    span.textContent = text;
    out.appendChild(span);
    out.scrollTop = out.scrollHeight;
}

function setCodeRunning(running) {
    const info = VAULT_CODE_LANGS[vaultCodeLang];
    document.getElementById('vault-code-run-btn').style.display  = (!running && info?.cmd) ? '' : 'none';
    document.getElementById('vault-code-kill-btn').style.display = running ? '' : 'none';
}

function killVaultCode() {
    if (vaultCodeProcess) { try { vaultCodeProcess.kill('SIGTERM'); } catch(_) {} vaultCodeProcess = null; }
    appendCodeOutput('\n[Process killed]\n', 'code-out-warn');
    setCodeRunning(false);
    const el = document.getElementById('vault-code-status');
    if (el) el.textContent = 'killed';
}

function runVaultCode() {
    if (!vaultCodeFilePath || !vaultAceEditor) return;
    const info = VAULT_CODE_LANGS[vaultCodeLang];
    if (!info?.cmd) { appendCodeOutput('No run command for this language.\n', 'code-out-warn'); return; }

    saveVaultCodeFile();
    clearCodeOutput();

    const fp  = vaultCodeFilePath;
    const tmp = path.join(os.tmpdir(), 'vulsor_code_out');
    let cmd;

    switch (info.cmd) {
        case '__compile_c':    cmd = `gcc "${fp}" -o "${tmp}" && "${tmp}"`; break;
        case '__compile_cpp':  cmd = `g++ "${fp}" -o "${tmp}" && "${tmp}"`; break;
        case '__compile_rust': cmd = `rustc "${fp}" -o "${tmp}" && "${tmp}"`; break;
        case '__compile_java': {
            const dir = path.dirname(fp), base = path.basename(fp, '.java');
            cmd = `javac "${fp}" -d "${dir}" && java -cp "${dir}" "${base}"`;
            break;
        }
        default: cmd = `${info.cmd} "${fp}"`;
    }

    const stdinVal = (document.getElementById('vault-code-stdin')?.value || '').trim();
    appendCodeOutput(`$ ${info.label}: ${path.basename(fp)}\n`, 'code-out-cmd');
    setCodeRunning(true);
    const statusEl = document.getElementById('vault-code-status');
    if (statusEl) statusEl.textContent = 'running…';

    const t0 = Date.now();
    const { spawn } = require('child_process');
    const proc = spawn('bash', ['-c', cmd], {
        env: {
            ...process.env,
            PATH: (process.env.PATH||'') + ':/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin',
            PYTHONUNBUFFERED: '1',
        }
    });
    vaultCodeProcess = proc;
    if (stdinVal) { proc.stdin.write(stdinVal + '\n'); proc.stdin.end(); }

    proc.stdout.on('data', d => appendCodeOutput(d.toString(), 'code-out-stdout'));
    proc.stderr.on('data', d => appendCodeOutput(d.toString(), 'code-out-stderr'));
    proc.on('close', code => {
        vaultCodeProcess = null;
        setCodeRunning(false);
        const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
        const ok = code === 0;
        appendCodeOutput(`\n[Exit ${code} · ${elapsed}s]\n`, ok ? 'code-out-exit-ok' : 'code-out-exit-err');
        if (statusEl) statusEl.textContent = ok ? `✓ ${elapsed}s` : `exit ${code}`;
    });
    proc.on('error', err => {
        vaultCodeProcess = null; setCodeRunning(false);
        appendCodeOutput(`\n[Error: ${err.message}]\n`, 'code-out-stderr');
        if (statusEl) statusEl.textContent = 'error';
    });
}

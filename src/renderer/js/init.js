Store._data.activeId = null
App.init()
var _ls = document.getElementById('ls')
if (_ls) {
  _ls.classList.add('ls-out')
  setTimeout(function() { if (_ls.parentNode) _ls.parentNode.removeChild(_ls) }, 500)
}

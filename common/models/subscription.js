const path = require('path')
var rsaPath = path.resolve(__dirname, '../../server/boot/rsa.js')
var rsa = require(rsaPath)

module.exports = function (Subscription) {
  Subscription.disableRemoteMethod('findOne', true)
  Subscription.disableRemoteMethod('findById', true)
  Subscription.disableRemoteMethod('createChangeStream', true)
  Subscription.disableRemoteMethod('exists', true)
  Subscription.disableRemoteMethod('updateAll', true)
  Subscription.disableRemoteMethod('count', true)
  Subscription.disableRemoteMethod('upsert', true)
  Subscription.disableRemoteMethod('deleteById', true)

  Subscription.observe('access', function (ctx, next) {
    var httpCtx = require('loopback').getCurrentContext()
    var u = httpCtx.active.http.req.get('sm_user') || httpCtx.active.http.req.get('smgov_userdisplayname')
    if (u) {
      ctx.query.where = ctx.query.where || {}
      ctx.query.where.userId = u
      ctx.query.where.state = {neq: 'deleted'}
    }
    next()
  })


  /**
   * hide confirmation request field, especially confirmation code
   */
  Subscription.afterRemote('*', function () {
    var ctx = arguments[0]
    var next = arguments[arguments.length - 1]
    if (arguments.length <= 2) {
      next()
    }
    var data = arguments[1]
    if (!data) {
      next()
    }
    var u = ctx.req.get('sm_user') || ctx.req.get('smgov_userdisplayname')
    if (u) {
      if (data instanceof Array) {
        data.forEach(function (e) {
          e.confirmationRequest = undefined
        })
        s
      }
      else {
        data.confirmationRequest = undefined
      }
    }
    next()
  })

  function handleConfirmationRequest(data, cb) {
    if (data.confirmationRequest.confirmationCodeRegex) {
      var RandExp = require('randexp')
      var confirmationCodeRegex = new RegExp(data.confirmationRequest.confirmationCodeRegex)
      data.confirmationRequest.confirmationCode = new RandExp(confirmationCodeRegex).gen()
    }
    if (data.confirmationRequest.confirmationCodeEncrypted) {
      var key = rsa.key
      var decrypted
      try {
        decrypted = key.decrypt(data.confirmationRequest.confirmationCodeEncrypted, 'utf8')
      }
      catch (ex) {
        return cb(ex, null)
      }
      var decryptedData = decrypted.split(' ')
      data.channelId = decryptedData[0]
      data.confirmationRequest.confirmationCode = decryptedData[1]
    }
    if (!data.confirmationRequest.sendRequest) {
      cb(null, null)
    }
    var nodemailer = require('nodemailer')
    var transporter = nodemailer.createTransport('direct:?name=localhost')
    var mailSubject = data.confirmationRequest.subject && data.confirmationRequest.subject.replace(/\{confirmation_code\}/i, data.confirmationRequest.confirmationCode)
    var mailTextBody = data.confirmationRequest.textBody && data.confirmationRequest.textBody.replace(/\{confirmation_code\}/i, data.confirmationRequest.confirmationCode)
    var mailHtmlBody = data.confirmationRequest.htmlBody && data.confirmationRequest.htmlBody.replace(/\{confirmation_code\}/i, data.confirmationRequest.confirmationCode)
    var mailOptions = {
      from: data.confirmationRequest.from,
      to: data.channelId,
      subject: mailSubject,
      text: mailTextBody,
      html: mailHtmlBody
    }
    transporter.sendMail(mailOptions, cb)
  }

  Subscription.beforeRemote('create', function (ctx, unused, next) {
    var u = ctx.req.get('sm_user') || ctx.req.get('smgov_userdisplayname')
    if (u) {
      ctx.args.data.userId = u
      if (!ctx.args.data.confirmationRequest) {
        // online channel must have confirmationRequest
        var error = new Error('Unauthorized')
        error.status = 401
        return next(error)
      }
    }
    if (!ctx.args.data.confirmationRequest) {
      // this can only come from admin channel
      return next()
    }
    handleConfirmationRequest(ctx.args.data, function (error, info) {
      if (error) {
        console.log(error)
      }
      next()
    })
  })

  Subscription.beforeRemote('deleteById', function (ctx, unused, next) {
    var u = ctx.req.get('sm_user') || ctx.req.get('smgov_userdisplayname') || 'unknown'
    Subscription.findById(ctx.args.id, null, null, function (err, data) {
      if (data.userId === u) {
        return next()
      }
      var error = new Error('Unauthorized')
      error.status = 401
      next(error)
    })
  })

  Subscription.beforeRemote('prototype.updateAttributes', function (ctx, instance, next) {
      var currUser = ctx.req.get('sm_user') || ctx.req.get('smgov_userdisplayname')
      if (currUser) {
        ctx.args.data.userId = currUser
        if (!ctx.args.data.confirmationRequest) {
          // online channel must have confirmationRequest
          var error = new Error('Unauthorized')
          error.status = 401
          return next(error)
        }
        ctx.args.data.state = 'unconfirmed'
      }
      if (!ctx.args.data.confirmationRequest) {
        // this can only come from admin channel
        return next()
      }
      handleConfirmationRequest(ctx.args.data, function (error, info) {
        if (error) {
          console.log(error)
        }
        next()
      })
    }
  )

  Subscription.prototype.deleteById = function (callback) {
    this.state = 'deleted'
    Subscription.replaceById(this.id, this, function (err, res) {
      callback(err, 1)
    })
  }

  Subscription.prototype.verify = function (confirmationCode, callback) {
    var error
    if (confirmationCode !== this.confirmationRequest.confirmationCode) {
      error = new Error('Unauthorized')
      error.status = 401
      return callback(error, "OK")
    }
    else {
      this.state = 'confirmed'
      Subscription.replaceById(this.id, this, function (err, res) {
        return callback(err, "OK")
      })
    }
  }
}
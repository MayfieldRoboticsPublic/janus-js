module.exports = function (grunt) {

  grunt.loadNpmTasks('grunt-contrib-clean');
  grunt.loadNpmTasks('grunt-contrib-copy');
  grunt.loadNpmTasks('grunt-contrib-jshint');
  grunt.loadNpmTasks('grunt-contrib-uglify');
  grunt.loadNpmTasks('grunt-contrib-watch');
  grunt.loadNpmTasks('grunt-coveralls');
  grunt.loadNpmTasks('grunt-karma');

  grunt.initConfig({
    pkg: grunt.file.readJSON('package.json'),

    clean: ['dist/**', 'coverage'],

    copy: {
      dist: {
        files: [ {
            src: 'janus.js',
            dest: 'dist/janus.js'
        }]
      }
    },

    coveralls: {
      options: {
        force: false
      },
      unit: {
        src: 'coverage/*/lcov.info'
      }
   },

    jshint: {
      build: ['Gruntfile.js'],
      src: ['janus.js', 'janus_test.js'],
      dist: 'dist/janus.js',
    },

    karma: {
      unit: {
        configFile: 'karma.conf.js',
        singleRun: true,
        browsers: ['PhantomJS'],
        coverageReporter: {
          type : 'lcov',
          dir : 'coverage/'
        }
      }
    },

    uglify: {
      dist: {
        options: {
        },
        files: {
          'dist/janus.min.js': 'janus.js',
        }
      }
    },
    
    watch: {
      grunt: {
        files: 'Gruntfile.js'
      },
      src: {
        files: ['bower_components/**', 'janus.js'],
        tasks: ['build']
      }
    }

  });

  grunt.registerTask('build', ['copy:dist', 'uglify:dist', 'jshint:dist']);
  grunt.registerTask('test', ['jshint:src', 'karma']);
  grunt.registerTask('default', ['test', 'build']);
};
